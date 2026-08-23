export class ConfigurationError extends Error {
  override name = "ConfigurationError"
}

export class ConfigDocumentError extends ConfigurationError {
  override name = "ConfigDocumentError"
}

export class DiscordAuditEvidenceError extends ConfigurationError {
  override name = "DiscordAuditEvidenceError"
}

export class BanAuditEvidenceError extends ConfigurationError {
  override name = "BanAuditEvidenceError"
}

export class InviteEvidenceError extends Error {
  override name = "InviteEvidenceError"
}

export class InviteDeletionPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord invite snapshot does not match the reviewed deletion plan")
    this.name = "InviteDeletionPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class InviteDeletionOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord invite deletion operation key has already been reserved")
    this.name = "InviteDeletionOperationConflictError"
    this.receipt = receipt
  }
}

export class InviteDeletionExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "InviteDeletionExecutionError"
    this.result = result
  }
}

export class PolicyError extends Error {
  override name = "PolicyError"
}

export class AuditLogError extends Error {
  override name = "AuditLogError"
}

export class AutoModerationPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord AutoMod snapshot does not match the reviewed plan")
    this.name = "AutoModerationPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class AutoModerationOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord AutoMod operation key has already been reserved")
    this.name = "AutoModerationOperationConflictError"
    this.receipt = receipt
  }
}

export class AutoModerationExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "AutoModerationExecutionError"
    this.result = result
  }
}

export class AutoModerationEvidenceError extends Error {
  override name = "AutoModerationEvidenceError"
}

export class OperationStoreError extends Error {
  override name = "OperationStoreError"
}

export class WriteCoordinationStateError extends Error {
  override name = "WriteCoordinationStateError"
}

export class WriteCoordinationConflictError extends Error {
  readonly claimId: string

  constructor(claimId: string) {
    super(
      `Reviewed Discord write claim ${claimId} already owns at least one required target; inspect it with discord-mcp coordination list`,
    )
    this.name = "WriteCoordinationConflictError"
    this.claimId = claimId
  }
}

export class WriteCoordinationQuarantinedError extends Error {
  readonly claimId: string

  constructor(claimId: string, options?: ErrorOptions) {
    super(
      `Reviewed Discord write claim ${claimId} is quarantined because its outcome is not safely settled; inspect Discord and run discord-mcp coordination list`,
      options,
    )
    this.name = "WriteCoordinationQuarantinedError"
    this.claimId = claimId
  }
}

export class WriteCoordinationResolutionError extends Error {
  override name = "WriteCoordinationResolutionError"
}

export class ProfileError extends Error {
  override name = "ProfileError"
}

export class ProfileCredentialError extends ProfileError {
  readonly kind: "conflict" | "missing"

  constructor(kind: "conflict" | "missing", message: string) {
    super(message)
    this.name = "ProfileCredentialError"
    this.kind = kind
  }
}

export class AttachmentMessagePlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord and local file snapshot does not match the reviewed attachment plan")
    this.name = "AttachmentMessagePlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class AttachmentMessageOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord attachment message operation key has already been reserved")
    this.name = "AttachmentMessageOperationConflictError"
    this.receipt = receipt
  }
}

export class AttachmentMessageExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "AttachmentMessageExecutionError"
    this.result = result
  }
}

export class ComponentMessageEvidenceError extends Error {
  override name = "ComponentMessageEvidenceError"
}

export class ComponentMessagePlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord component-message snapshot does not match the reviewed plan")
    this.name = "ComponentMessagePlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class ComponentMessageOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord component-message operation key has already been reserved")
    this.name = "ComponentMessageOperationConflictError"
    this.receipt = receipt
  }
}

export class ComponentMessageExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "ComponentMessageExecutionError"
    this.result = result
  }
}

export class ChannelCreationPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord channel snapshot does not match the reviewed creation plan")
    this.name = "ChannelCreationPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class ChannelCreationOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord channel creation operation key has already been reserved")
    this.name = "ChannelCreationOperationConflictError"
    this.receipt = receipt
  }
}

export class ChannelCreationExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "ChannelCreationExecutionError"
    this.result = result
  }
}

export class ChannelClonePlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord channel snapshot does not match the reviewed clone plan")
    this.name = "ChannelClonePlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class ChannelCloneOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord channel-clone operation key has already been reserved")
    this.name = "ChannelCloneOperationConflictError"
    this.receipt = receipt
  }
}

export class ChannelCloneExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "ChannelCloneExecutionError"
    this.result = result
  }
}

export class ChannelCloneEvidenceError extends Error {
  override name = "ChannelCloneEvidenceError"
}

export class ChannelCloneVerificationTimeoutError extends Error {
  override name = "ChannelCloneVerificationTimeoutError"
}

export class ChannelMetadataPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord channel metadata snapshot does not match the reviewed plan")
    this.name = "ChannelMetadataPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class ChannelMetadataOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord channel metadata operation key has already been reserved")
    this.name = "ChannelMetadataOperationConflictError"
    this.receipt = receipt
  }
}

export class ChannelMetadataExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "ChannelMetadataExecutionError"
    this.result = result
  }
}

export class ChannelMetadataEvidenceError extends Error {
  override name = "ChannelMetadataEvidenceError"
}

export class ChannelOrderingPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord channel layout does not match the reviewed ordering plan")
    this.name = "ChannelOrderingPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class ChannelOrderingOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord channel-ordering operation key has already been reserved")
    this.name = "ChannelOrderingOperationConflictError"
    this.receipt = receipt
  }
}

export class ChannelOrderingExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "ChannelOrderingExecutionError"
    this.result = result
  }
}

export class ChannelOrderingEvidenceError extends Error {
  override name = "ChannelOrderingEvidenceError"
}

export class ChannelOrderingVerificationTimeoutError extends Error {
  override name = "ChannelOrderingVerificationTimeoutError"
}

export class ForumTagPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord forum-tag snapshot does not match the reviewed plan")
    this.name = "ForumTagPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class ForumTagOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord forum-tag operation key has already been reserved")
    this.name = "ForumTagOperationConflictError"
    this.receipt = receipt
  }
}

export class ForumTagExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "ForumTagExecutionError"
    this.result = result
  }
}

export class ForumTagEvidenceError extends Error {
  override name = "ForumTagEvidenceError"
}

export class ForumPostPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord forum snapshot does not match the reviewed post plan")
    this.name = "ForumPostPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class ForumPostOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord forum-post operation key has already been reserved")
    this.name = "ForumPostOperationConflictError"
    this.receipt = receipt
  }
}

export class ForumPostExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "ForumPostExecutionError"
    this.result = result
  }
}

export class ForumPostEvidenceError extends Error {
  override name = "ForumPostEvidenceError"
}

export class ThreadCreationPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord thread snapshot does not match the reviewed creation plan")
    this.name = "ThreadCreationPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class ThreadCreationOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord thread-creation operation key has already been reserved")
    this.name = "ThreadCreationOperationConflictError"
    this.receipt = receipt
  }
}

export class ThreadCreationExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "ThreadCreationExecutionError"
    this.result = result
  }
}

export class ThreadCreationEvidenceError extends Error {
  override name = "ThreadCreationEvidenceError"
}

export class StageInstancePlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord Stage-instance snapshot does not match the reviewed plan")
    this.name = "StageInstancePlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class StageInstanceOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord Stage-instance operation key has already been reserved")
    this.name = "StageInstanceOperationConflictError"
    this.receipt = receipt
  }
}

export class StageInstanceExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "StageInstanceExecutionError"
    this.result = result
  }
}

export class StageInstanceEvidenceError extends Error {
  override name = "StageInstanceEvidenceError"
}

export class GuildScaffoldPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord guild snapshot does not match the reviewed scaffold plan")
    this.name = "GuildScaffoldPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class GuildScaffoldOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(message: string, receipt: unknown) {
    super(message)
    this.name = "GuildScaffoldOperationConflictError"
    this.receipt = receipt
  }
}

export class GuildScaffoldExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "GuildScaffoldExecutionError"
    this.result = result
  }
}

export class MessagePinPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord message snapshot does not match the reviewed pin plan")
    this.name = "MessagePinPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class MessagePinOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord message pin operation key has already been reserved")
    this.name = "MessagePinOperationConflictError"
    this.receipt = receipt
  }
}

export class MessagePinExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "MessagePinExecutionError"
    this.result = result
  }
}

export class AnnouncementCrosspostPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord message snapshot does not match the reviewed announcement-crosspost plan")
    this.name = "AnnouncementCrosspostPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class AnnouncementCrosspostOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord announcement-crosspost operation key has already been reserved")
    this.name = "AnnouncementCrosspostOperationConflictError"
    this.receipt = receipt
  }
}

export class AnnouncementCrosspostExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "AnnouncementCrosspostExecutionError"
    this.result = result
  }
}

export class MessageForwardPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord source or target snapshot does not match the reviewed message-forward plan")
    this.name = "MessageForwardPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class MessageForwardOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord message-forward operation key has already been reserved")
    this.name = "MessageForwardOperationConflictError"
    this.receipt = receipt
  }
}

export class MessageForwardExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "MessageForwardExecutionError"
    this.result = result
  }
}

export class MessageForwardEvidenceError extends Error {
  override name = "MessageForwardEvidenceError"
}

export class NativeInteractionCommandPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord command inventory does not match the reviewed native Interaction command plan")
    this.name = "NativeInteractionCommandPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class NativeInteractionCommandConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord native Interaction command operation key has already been reserved")
    this.name = "NativeInteractionCommandConflictError"
    this.receipt = receipt
  }
}

export class NativeInteractionCommandExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "NativeInteractionCommandExecutionError"
    this.result = result
  }
}

export class NativeInteractionResponseError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "NativeInteractionResponseError"
    this.result = result
  }
}

export class WebhookDeletionPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord webhook snapshot does not match the reviewed deletion plan")
    this.name = "WebhookDeletionPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class WebhookDeletionOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord webhook deletion operation key has already been reserved")
    this.name = "WebhookDeletionOperationConflictError"
    this.receipt = receipt
  }
}

export class WebhookDeletionExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "WebhookDeletionExecutionError"
    this.result = result
  }
}

export class WebhookCreationPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord webhook snapshot does not match the reviewed creation plan")
    this.name = "WebhookCreationPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class WebhookCreationOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord webhook creation operation key has already been reserved")
    this.name = "WebhookCreationOperationConflictError"
    this.receipt = receipt
  }
}

export class WebhookCreationExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "WebhookCreationExecutionError"
    this.result = result
  }
}

export class WebhookChangePlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord webhook snapshot does not match the reviewed metadata-change plan")
    this.name = "WebhookChangePlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class WebhookChangeOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord webhook change operation key has already been reserved")
    this.name = "WebhookChangeOperationConflictError"
    this.receipt = receipt
  }
}

export class WebhookChangeExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "WebhookChangeExecutionError"
    this.result = result
  }
}

export class WebhookEvidenceError extends Error {
  override name = "WebhookEvidenceError"
}

export class AnnouncementSubscriptionPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord announcement subscription snapshot does not match the reviewed plan")
    this.name = "AnnouncementSubscriptionPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class AnnouncementSubscriptionOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord announcement subscription operation key has already been reserved")
    this.name = "AnnouncementSubscriptionOperationConflictError"
    this.receipt = receipt
  }
}

export class AnnouncementSubscriptionExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "AnnouncementSubscriptionExecutionError"
    this.result = result
  }
}

export class AnnouncementSubscriptionEvidenceError extends Error {
  override name = "AnnouncementSubscriptionEvidenceError"
}

export class IntegrationDeletionPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord integration snapshot does not match the reviewed deletion plan")
    this.name = "IntegrationDeletionPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class IntegrationDeletionOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord integration deletion operation key has already been reserved")
    this.name = "IntegrationDeletionOperationConflictError"
    this.receipt = receipt
  }
}

export class IntegrationDeletionExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "IntegrationDeletionExecutionError"
    this.result = result
  }
}

export class IntegrationEvidenceError extends Error {
  override name = "IntegrationEvidenceError"
}

export class ApplicationEmojiPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord application emoji snapshot does not match the reviewed plan")
    this.name = "ApplicationEmojiPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class ApplicationEmojiOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord application emoji operation key has already been reserved")
    this.name = "ApplicationEmojiOperationConflictError"
    this.receipt = receipt
  }
}

export class ApplicationEmojiExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "ApplicationEmojiExecutionError"
    this.result = result
  }
}

export class ApplicationEmojiEvidenceError extends Error {
  override name = "ApplicationEmojiEvidenceError"
}

export class GuildExpressionPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord guild expression snapshot does not match the reviewed plan")
    this.name = "GuildExpressionPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class GuildExpressionOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord guild expression operation key has already been reserved")
    this.name = "GuildExpressionOperationConflictError"
    this.receipt = receipt
  }
}

export class GuildExpressionExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "GuildExpressionExecutionError"
    this.result = result
  }
}

export class GuildExpressionEvidenceError extends Error {
  override name = "GuildExpressionEvidenceError"
}

export class SoundboardPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord guild soundboard snapshot does not match the reviewed plan")
    this.name = "SoundboardPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class SoundboardOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord guild soundboard operation key has already been reserved")
    this.name = "SoundboardOperationConflictError"
    this.receipt = receipt
  }
}

export class SoundboardExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "SoundboardExecutionError"
    this.result = result
  }
}

export class SoundboardEvidenceError extends Error {
  override name = "SoundboardEvidenceError"
}

export class WelcomeScreenPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord Welcome Screen snapshot does not match the reviewed plan")
    this.name = "WelcomeScreenPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class WelcomeScreenOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord Welcome Screen operation key has already been reserved")
    this.name = "WelcomeScreenOperationConflictError"
    this.receipt = receipt
  }
}

export class WelcomeScreenExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "WelcomeScreenExecutionError"
    this.result = result
  }
}

export class WelcomeScreenEvidenceError extends Error {
  override name = "WelcomeScreenEvidenceError"
}

export class GuildSettingsPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord guild-settings snapshot does not match the reviewed plan")
    this.name = "GuildSettingsPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class GuildSettingsOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord guild-settings operation key has already been reserved")
    this.name = "GuildSettingsOperationConflictError"
    this.receipt = receipt
  }
}

export class GuildSettingsExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "GuildSettingsExecutionError"
    this.result = result
  }
}

export class GuildSettingsEvidenceError extends Error {
  override name = "GuildSettingsEvidenceError"
}

export class GuildProfilePlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord guild profile snapshot does not match the reviewed plan")
    this.name = "GuildProfilePlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class GuildProfileOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord guild profile operation key has already been reserved")
    this.name = "GuildProfileOperationConflictError"
    this.receipt = receipt
  }
}

export class GuildProfileExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "GuildProfileExecutionError"
    this.result = result
  }
}

export class GuildProfileEvidenceError extends Error {
  override name = "GuildProfileEvidenceError"
}

export class WidgetSettingsPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord widget-settings snapshot does not match the reviewed plan")
    this.name = "WidgetSettingsPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class WidgetSettingsOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord widget-settings operation key has already been reserved")
    this.name = "WidgetSettingsOperationConflictError"
    this.receipt = receipt
  }
}

export class WidgetSettingsExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "WidgetSettingsExecutionError"
    this.result = result
  }
}

export class WidgetSettingsEvidenceError extends Error {
  override name = "WidgetSettingsEvidenceError"
}

export class MemberVoicePlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord member voice snapshot does not match the reviewed plan")
    this.name = "MemberVoicePlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class MemberVoiceOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord member voice operation key has already been reserved")
    this.name = "MemberVoiceOperationConflictError"
    this.receipt = receipt
  }
}

export class MemberVoiceExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "MemberVoiceExecutionError"
    this.result = result
  }
}

export class MemberVoiceEvidenceError extends Error {
  override name = "MemberVoiceEvidenceError"
}

export class MemberNicknamePlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord member nickname snapshot does not match the reviewed plan")
    this.name = "MemberNicknamePlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class MemberNicknameOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord member nickname operation key has already been reserved")
    this.name = "MemberNicknameOperationConflictError"
    this.receipt = receipt
  }
}

export class MemberNicknameExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "MemberNicknameExecutionError"
    this.result = result
  }
}

export class MemberNicknameEvidenceError extends Error {
  override name = "MemberNicknameEvidenceError"
}

export class ThreadGovernancePlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord thread snapshot does not match the reviewed governance plan")
    this.name = "ThreadGovernancePlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class ThreadGovernanceOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord thread-governance operation key has already been reserved")
    this.name = "ThreadGovernanceOperationConflictError"
    this.receipt = receipt
  }
}

export class ThreadGovernanceExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "ThreadGovernanceExecutionError"
    this.result = result
  }
}

export class ThreadGovernanceEvidenceError extends Error {
  override name = "ThreadGovernanceEvidenceError"
}

export class OnboardingPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord onboarding snapshot does not match the reviewed plan")
    this.name = "OnboardingPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class OnboardingOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord onboarding operation key has already been reserved")
    this.name = "OnboardingOperationConflictError"
    this.receipt = receipt
  }
}

export class OnboardingExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "OnboardingExecutionError"
    this.result = result
  }
}

export class OnboardingEvidenceError extends Error {
  override name = "OnboardingEvidenceError"
}

export class ScheduledEventPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord scheduled event snapshot does not match the reviewed plan")
    this.name = "ScheduledEventPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class ScheduledEventOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord scheduled event operation key has already been reserved")
    this.name = "ScheduledEventOperationConflictError"
    this.receipt = receipt
  }
}

export class ScheduledEventExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "ScheduledEventExecutionError"
    this.result = result
  }
}

export class ScheduledEventEvidenceError extends Error {
  override name = "ScheduledEventEvidenceError"
}

export class ChannelPermissionOverwritePlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord channel permission snapshot does not match the reviewed plan")
    this.name = "ChannelPermissionOverwritePlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class ChannelPermissionOverwriteOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord channel permission operation key has already been reserved")
    this.name = "ChannelPermissionOverwriteOperationConflictError"
    this.receipt = receipt
  }
}

export class ChannelPermissionOverwriteExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "ChannelPermissionOverwriteExecutionError"
    this.result = result
  }
}

export class RoleCreationPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord role snapshot does not match the reviewed creation plan")
    this.name = "RoleCreationPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class RoleCreationOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord role creation operation key has already been reserved")
    this.name = "RoleCreationOperationConflictError"
    this.receipt = receipt
  }
}

export class RoleCreationExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "RoleCreationExecutionError"
    this.result = result
  }
}

export class RoleConfigurationPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord role snapshot does not match the reviewed configuration plan")
    this.name = "RoleConfigurationPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class RoleConfigurationOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord role configuration operation key has already been reserved")
    this.name = "RoleConfigurationOperationConflictError"
    this.receipt = receipt
  }
}

export class RoleConfigurationExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "RoleConfigurationExecutionError"
    this.result = result
  }
}

export class RoleConfigurationEvidenceError extends Error {
  override name = "RoleConfigurationEvidenceError"
}

export class RoleOrderingPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord role hierarchy does not match the reviewed ordering plan")
    this.name = "RoleOrderingPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class RoleOrderingOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord role-ordering operation key has already been reserved")
    this.name = "RoleOrderingOperationConflictError"
    this.receipt = receipt
  }
}

export class RoleOrderingExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "RoleOrderingExecutionError"
    this.result = result
  }
}

export class RoleOrderingEvidenceError extends Error {
  override name = "RoleOrderingEvidenceError"
}

export class PollEvidenceError extends Error {
  override name = "PollEvidenceError"
}

export class PollPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord poll snapshot does not match the reviewed plan")
    this.name = "PollPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class PollOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord poll operation key has already been reserved")
    this.name = "PollOperationConflictError"
    this.receipt = receipt
  }
}

export class PollExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "PollExecutionError"
    this.result = result
  }
}

export class ReactionEvidenceError extends Error {
  override name = "ReactionEvidenceError"
}

export class ReactionModerationPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord reaction snapshot does not match the reviewed plan")
    this.name = "ReactionModerationPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class ReactionModerationOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord reaction-moderation operation key has already been reserved")
    this.name = "ReactionModerationOperationConflictError"
    this.receipt = receipt
  }
}

export class ReactionModerationExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "ReactionModerationExecutionError"
    this.result = result
  }
}

export class MemberRolePlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord member-role snapshot does not match the reviewed plan")
    this.name = "MemberRolePlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class MemberRoleOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord member-role operation key has already been reserved")
    this.name = "MemberRoleOperationConflictError"
    this.receipt = receipt
  }
}

export class MemberRoleExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "MemberRoleExecutionError"
    this.result = result
  }
}

export class AdministrationPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord member snapshot does not match the reviewed administration plan")
    this.name = "AdministrationPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class AdministrationExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "AdministrationExecutionError"
    this.result = result
  }
}

export class GuildTemplateEvidenceError extends Error {
  override name = "GuildTemplateEvidenceError"
}

export class GuildTemplatePlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord guild-template snapshot does not match the reviewed plan")
    this.name = "GuildTemplatePlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class GuildTemplateOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord guild-template operation key has already been reserved")
    this.name = "GuildTemplateOperationConflictError"
    this.receipt = receipt
  }
}

export class GuildTemplateExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "GuildTemplateExecutionError"
    this.result = result
  }
}

export class DiscordApiError extends Error {
  readonly code: number | undefined
  readonly method: string
  readonly retryAfterMs: number | undefined
  readonly route: string
  readonly status: number

  constructor(options: {
    code?: number
    message: string
    method: string
    retryAfterMs?: number
    route: string
    status: number
  }) {
    super(options.message)
    this.name = "DiscordApiError"
    this.code = options.code
    this.method = options.method
    this.retryAfterMs = options.retryAfterMs
    this.route = options.route
    this.status = options.status
  }
}

export class DeletionPlanChangedError extends Error {
  readonly actualDigest: string
  readonly expectedDigest: string

  constructor(expectedDigest: string, actualDigest: string) {
    super("The fresh Discord message snapshot does not match the reviewed deletion plan")
    this.name = "DeletionPlanChangedError"
    this.actualDigest = actualDigest
    this.expectedDigest = expectedDigest
  }
}

export class DeletionOperationConflictError extends Error {
  readonly receipt: unknown

  constructor(receipt: unknown) {
    super("Discord message deletion operation key has already been reserved")
    this.name = "DeletionOperationConflictError"
    this.receipt = receipt
  }
}

export class DeletionExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "DeletionExecutionError"
    this.result = result
  }
}

export class InteractionConflictError extends Error {
  override name = "InteractionConflictError"
}

export class InteractionExecutionError extends Error {
  readonly result: unknown

  constructor(message: string, result: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = "InteractionExecutionError"
    this.result = result
  }
}

export class InteractionIdentityError extends Error {
  override name = "InteractionIdentityError"
}

export class InteractionRateLimitError extends Error {
  readonly retryAfterMs: number

  constructor(retryAfterMs: number) {
    super(`Local Discord interaction guard requires a retry after ${retryAfterMs} ms`)
    this.name = "InteractionRateLimitError"
    this.retryAfterMs = retryAfterMs
  }
}

export function redactText(value: string, secrets: readonly (string | undefined)[]): string {
  let output = value
  for (const secret of secrets) {
    if (secret && secret.length > 0) output = output.replaceAll(secret, "[redacted]")
  }
  return output
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
