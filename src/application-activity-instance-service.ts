import {
  normalizeApplicationActivityInstanceId,
  type DiscordApplicationActivityInstance,
} from "./application-activity-instance.js"
import {
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type { DiscordClient } from "./discord-client.js"
import {
  ApplicationActivityInstanceEvidenceError,
  DiscordApiError,
  PolicyError,
} from "./errors.js"
import type { RequestOptions } from "./types.js"

export interface ApplicationActivityInstanceRequest {
  channelId: string
  guildId: string
  instanceId: string
  userId?: string | undefined
}

export interface NormalizedApplicationActivityInstanceRequest {
  channelId: string
  guildId: string
  instanceId: string
  userId: string | null
}

export interface ApplicationActivityInstanceInspectionResult {
  active: boolean
  application: {
    botId: string
    id: string
  }
  evidence: {
    locationUnknownFields: number | null
    responseUnknownFields: number | null
  }
  expected: {
    channelId: string
    guildId: string
    user: {
      id: string
      present: boolean | null
    } | null
  }
  instanceId: string
  launchId: string | null
  location: {
    channelId: string
    guildId: string
    kind: "guild-channel"
  } | null
  participantCount: number | null
  privacy: {
    omitted: readonly string[]
    participantEvidence: "count-and-exact-membership-only"
    persistence: "none"
    rawPayloads: "omitted"
    unknownFields: "counts-only"
  }
  schemaVersion: number
  status: "ok"
  warnings: readonly string[]
}

export interface ApplicationActivityInstanceServiceClient {
  getApplicationActivityInstance?: DiscordClient["getApplicationActivityInstance"]
}

export interface ApplicationActivityInstanceServiceOptions {
  client: ApplicationActivityInstanceServiceClient
  policy: ApplicationActivityInstancePolicy
}

export interface ApplicationActivityInstancePolicy {
  assertGuildAllowed(guildId: string): void
  channelIdReadable(channelId: string): boolean
}

const REQUEST_FIELDS = new Set(["channelId", "guildId", "instanceId", "userId"])
const PRIVACY_OMISSIONS = Object.freeze([
  "display-names",
  "location-opaque-id",
  "participant-enumeration",
  "profiles",
  "raw-discord-payloads",
  "unknown-field-values",
] as const)
const WARNINGS = Object.freeze([
  "The result is one transient snapshot and can change immediately",
  "Only the pinned current application and one expected guild channel are verified",
  "Participant identities are omitted except for the optional caller-supplied exact-user membership answer",
] as const)

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertPositiveSnowflake(value: unknown, description: string): asserts value is string {
  if (!positiveSnowflake(value)) throw new RangeError(`${description} is invalid`)
}

function evidenceError(): ApplicationActivityInstanceEvidenceError {
  return new ApplicationActivityInstanceEvidenceError(
    "Discord returned invalid or mismatched application Activity-instance evidence",
  )
}

export function normalizeApplicationActivityInstanceRequest(
  value: ApplicationActivityInstanceRequest,
): NormalizedApplicationActivityInstanceRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord application Activity-instance request is invalid")
  }
  for (const key of Object.keys(value)) {
    if (!REQUEST_FIELDS.has(key)) {
      throw new RangeError("Discord application Activity-instance request contains unknown fields")
    }
  }
  assertPositiveSnowflake(value.guildId, "Discord application Activity guild ID")
  assertPositiveSnowflake(value.channelId, "Discord application Activity channel ID")
  if (value.userId !== undefined) {
    assertPositiveSnowflake(value.userId, "Discord application Activity user ID")
  }
  return {
    channelId: value.channelId,
    guildId: value.guildId,
    instanceId: normalizeApplicationActivityInstanceId(value.instanceId),
    userId: value.userId ?? null,
  }
}

function resultBase(
  applicationId: string,
  botId: string,
  request: NormalizedApplicationActivityInstanceRequest,
) {
  return {
    application: { botId, id: applicationId },
    expected: {
      channelId: request.channelId,
      guildId: request.guildId,
      user: request.userId === null
        ? null
        : { id: request.userId, present: null },
    },
    instanceId: request.instanceId,
    privacy: {
      omitted: PRIVACY_OMISSIONS,
      participantEvidence: "count-and-exact-membership-only" as const,
      persistence: "none" as const,
      rawPayloads: "omitted" as const,
      unknownFields: "counts-only" as const,
    },
    schemaVersion: SCHEMA_VERSION,
    status: "ok" as const,
    warnings: WARNINGS,
  }
}

function activeResult(
  applicationId: string,
  botId: string,
  request: NormalizedApplicationActivityInstanceRequest,
  instance: DiscordApplicationActivityInstance,
): ApplicationActivityInstanceInspectionResult {
  if (
    instance.applicationId !== applicationId
    || instance.instanceId !== request.instanceId
    || instance.location.kind !== "gc"
    || instance.location.guildId !== request.guildId
    || instance.location.channelId !== request.channelId
  ) throw evidenceError()
  return {
    ...resultBase(applicationId, botId, request),
    active: true,
    evidence: {
      locationUnknownFields: instance.location.unknownFieldCount,
      responseUnknownFields: instance.unknownFieldCount,
    },
    expected: {
      channelId: request.channelId,
      guildId: request.guildId,
      user: request.userId === null
        ? null
        : { id: request.userId, present: instance.userIds.includes(request.userId) },
    },
    launchId: instance.launchId,
    location: {
      channelId: request.channelId,
      guildId: request.guildId,
      kind: "guild-channel",
    },
    participantCount: instance.userIds.length,
  }
}

function inactiveResult(
  applicationId: string,
  botId: string,
  request: NormalizedApplicationActivityInstanceRequest,
): ApplicationActivityInstanceInspectionResult {
  return {
    ...resultBase(applicationId, botId, request),
    active: false,
    evidence: {
      locationUnknownFields: null,
      responseUnknownFields: null,
    },
    launchId: null,
    location: null,
    participantCount: null,
  }
}

export class ApplicationActivityInstanceService {
  readonly #client: ApplicationActivityInstanceServiceClient
  readonly #policy: ApplicationActivityInstancePolicy

  constructor(options: ApplicationActivityInstanceServiceOptions) {
    this.#client = options.client
    this.#policy = options.policy
  }

  async inspect(
    applicationId: string,
    botId: string,
    value: ApplicationActivityInstanceRequest,
    options: RequestOptions = {},
  ): Promise<ApplicationActivityInstanceInspectionResult> {
    const request = normalizeApplicationActivityInstanceRequest(value)
    this.#policy.assertGuildAllowed(request.guildId)
    if (!this.#policy.channelIdReadable(request.channelId)) {
      throw new PolicyError(
        `Discord channel ${request.channelId} is outside the exact configured read scope`,
      )
    }
    if (!positiveSnowflake(applicationId) || !positiveSnowflake(botId)) throw evidenceError()
    if (!this.#client.getApplicationActivityInstance) {
      throw new ApplicationActivityInstanceEvidenceError(
        "Discord application Activity-instance inspection requires complete client support",
      )
    }
    try {
      const instance = await this.#client.getApplicationActivityInstance(
        applicationId,
        request.instanceId,
        options,
      )
      return activeResult(applicationId, botId, request, instance)
    } catch (error) {
      if (error instanceof DiscordApiError && error.status === 404) {
        return inactiveResult(applicationId, botId, request)
      }
      throw error
    }
  }
}
