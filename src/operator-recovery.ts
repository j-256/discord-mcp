import {
  ConfigChangeError,
  ConfigurationError,
  DiscordApiError,
  errorMessage,
  ProfileError,
  RuntimeConfigurationRequiredError,
  WriteCoordinationConflictError,
  WriteCoordinationQuarantinedError,
  WriteCoordinationResolutionError,
  WriteCoordinationStateError,
} from "./errors.js"

export const OPERATOR_RETRY = Object.freeze({
  afterCorrection: "after-correction",
  afterDelay: "after-delay",
  afterInspection: "after-inspection",
} as const)

export type OperatorRetry = typeof OPERATOR_RETRY[keyof typeof OPERATOR_RETRY]

export const CLI_FAILURE_CATEGORIES = Object.freeze({
  configuration: "configuration",
  discordAuthentication: "discord-authentication",
  discordPermission: "discord-permission",
  discordRateLimit: "discord-rate-limit",
  discordRemote: "discord-remote",
  operation: "operation",
  profile: "profile",
  usage: "usage",
  writeCoordination: "write-coordination",
} as const)

export type CliFailureCategory = typeof CLI_FAILURE_CATEGORIES[
  keyof typeof CLI_FAILURE_CATEGORIES
]

export interface OperatorRecovery {
  action: string
  reference: string
  retry: OperatorRetry
}

export interface CliFailureGuidance {
  category: CliFailureCategory
  recovery: OperatorRecovery
  retryAfterMs?: number
}

export interface CliFailureContext {
  helpTopic?: string
  usage: boolean
}

const OPERATOR_REFERENCES = Object.freeze({
  botSetup: "docs/reference.md#discord-bot-setup",
  configuration: "docs/reference.md#configuration",
  hostInstallation: "docs/reference.md#reviewed-host-configuration-installation",
  operatorCli: "docs/reference.md#operator-cli",
  verification: "docs/reference.md#verification",
})

function guidance(
  category: CliFailureCategory,
  action: string,
  reference: string,
  retry: OperatorRetry,
  retryAfterMs?: number,
): CliFailureGuidance {
  return {
    category,
    recovery: { action, reference, retry },
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  }
}

export function classifyCliFailure(
  error: unknown,
  context: CliFailureContext,
): CliFailureGuidance {
  if (context.usage) {
    const helpCommand = context.helpTopic
      ? `guildctl help ${context.helpTopic}`
      : "guildctl help"
    return guidance(
      CLI_FAILURE_CATEGORIES.usage,
      `Run ${helpCommand} and correct the command before retrying.`,
      OPERATOR_REFERENCES.operatorCli,
      OPERATOR_RETRY.afterCorrection,
    )
  }
  if (error instanceof ProfileError) {
    return guidance(
      CLI_FAILURE_CATEGORIES.profile,
      "Run guildctl profile list, inspect the intended profile, and retry only after its state is known.",
      OPERATOR_REFERENCES.operatorCli,
      OPERATOR_RETRY.afterInspection,
    )
  }
  if (error instanceof RuntimeConfigurationRequiredError) {
    return guidance(
      CLI_FAILURE_CATEGORIES.configuration,
      "Create a policy with guildctl config init or setup --preset, then select it with --config or --profile.",
      OPERATOR_REFERENCES.configuration,
      OPERATOR_RETRY.afterCorrection,
    )
  }
  if (error instanceof ConfigChangeError) {
    const action = error.reason === "active"
      ? "Run guildctl config validate ACTIVE_FILE, correct the active policy, and create a fresh config plan before retrying."
      : error.reason === "candidate"
        ? "Run guildctl config validate CANDIDATE_FILE, correct the candidate policy, and create a fresh config plan before retrying."
        : error.reason === "identity"
          ? "Keep the active application and bot IDs unchanged, or create a separate configuration for the different Discord bot."
          : "Rerun guildctl config plan ACTIVE_FILE CANDIDATE_FILE, review the fresh digest and changes, then apply only that exact plan."
    return guidance(
      CLI_FAILURE_CATEGORIES.configuration,
      action,
      OPERATOR_REFERENCES.configuration,
      OPERATOR_RETRY.afterCorrection,
    )
  }
  if (error instanceof DiscordApiError) {
    if (error.status === 401) {
      return guidance(
        CLI_FAILURE_CATEGORIES.discordAuthentication,
        "Verify the caller-owned bot credential and expected identity with guildctl doctor --online before retrying.",
        OPERATOR_REFERENCES.botSetup,
        OPERATOR_RETRY.afterCorrection,
      )
    }
    if (error.status === 403) {
      return guidance(
        CLI_FAILURE_CATEGORIES.discordPermission,
        "Run guildctl doctor --online, then correct the bot installation, role hierarchy, Discord permissions, or exact local scope before retrying.",
        OPERATOR_REFERENCES.botSetup,
        OPERATOR_RETRY.afterCorrection,
      )
    }
    if (error.status === 429) {
      const delay = error.retryAfterMs === undefined
        ? "Wait for the reported Discord retry window"
        : `Wait at least ${error.retryAfterMs} ms`
      return guidance(
        CLI_FAILURE_CATEGORIES.discordRateLimit,
        `${delay}, then rerun only a read-only diagnostic; inspect state before repeating any state-changing command.`,
        OPERATOR_REFERENCES.verification,
        OPERATOR_RETRY.afterDelay,
        error.retryAfterMs,
      )
    }
    if (error.status >= 500) {
      return guidance(
        CLI_FAILURE_CATEGORIES.discordRemote,
        "Wait for Discord service health to recover, rerun guildctl doctor --online, and inspect state before repeating any state-changing command.",
        OPERATOR_REFERENCES.verification,
        OPERATOR_RETRY.afterDelay,
      )
    }
    return guidance(
      CLI_FAILURE_CATEGORIES.discordRemote,
      "Run guildctl doctor --online and correct the exact identity, scope, or request evidence before retrying.",
      OPERATOR_REFERENCES.verification,
      OPERATOR_RETRY.afterCorrection,
    )
  }
  if (
    error instanceof WriteCoordinationConflictError
    || error instanceof WriteCoordinationQuarantinedError
    || error instanceof WriteCoordinationResolutionError
    || error instanceof WriteCoordinationStateError
  ) {
    return guidance(
      CLI_FAILURE_CATEGORIES.writeCoordination,
      "Run guildctl coordination list and inspect Discord before resolving or repeating the affected write.",
      OPERATOR_REFERENCES.operatorCli,
      OPERATOR_RETRY.afterInspection,
    )
  }
  if (error instanceof ConfigurationError) {
    if (context.helpTopic === "host") {
      return guidance(
        CLI_FAILURE_CATEGORIES.configuration,
        "Validate the selected policy. If a host file was involved, inspect it and any sibling recovery artifacts; rerun host plan and apply only a fresh reviewed digest after state is known.",
        OPERATOR_REFERENCES.hostInstallation,
        OPERATOR_RETRY.afterInspection,
      )
    }
    return guidance(
      CLI_FAILURE_CATEGORIES.configuration,
      "Run guildctl doctor with the intended --config or --profile, resolve every failing check, and retry only with that credential, identity, scope, and policy.",
      OPERATOR_REFERENCES.configuration,
      OPERATOR_RETRY.afterCorrection,
    )
  }
  return guidance(
    CLI_FAILURE_CATEGORIES.operation,
    "Run guildctl doctor with the intended --config or --profile and inspect the reported local or Discord state before retrying.",
    OPERATOR_REFERENCES.verification,
    OPERATOR_RETRY.afterInspection,
  )
}

export function safeCliFailureMessage(
  error: unknown,
  context: CliFailureContext,
): string {
  if (context.usage) return "Invalid command usage"
  if (error instanceof DiscordApiError) {
    return `Discord API request returned status ${error.status}`
  }
  if (
    error instanceof ConfigurationError
    || error instanceof ProfileError
    || error instanceof WriteCoordinationConflictError
    || error instanceof WriteCoordinationQuarantinedError
    || error instanceof WriteCoordinationResolutionError
    || error instanceof WriteCoordinationStateError
  ) return errorMessage(error)
  return "Operator command failed"
}
