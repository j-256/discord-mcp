export class ConfigurationError extends Error {
  override name = "ConfigurationError"
}

export class DiscordAuditEvidenceError extends ConfigurationError {
  override name = "DiscordAuditEvidenceError"
}

export class PolicyError extends Error {
  override name = "PolicyError"
}

export class AuditLogError extends Error {
  override name = "AuditLogError"
}

export class OperationStoreError extends Error {
  override name = "OperationStoreError"
}

export class ProfileError extends Error {
  override name = "ProfileError"
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

export class WebhookEvidenceError extends Error {
  override name = "WebhookEvidenceError"
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
