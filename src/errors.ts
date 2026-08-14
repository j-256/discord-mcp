export class ConfigurationError extends Error {
  override name = "ConfigurationError"
}

export class PolicyError extends Error {
  override name = "PolicyError"
}

export class AuditLogError extends Error {
  override name = "AuditLogError"
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
