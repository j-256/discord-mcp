import { DISCORD_LIMITS, SCHEMA_VERSION } from "./constants.js"
import type {
  DiscordClient,
  DiscordVoiceRegion,
} from "./discord-client.js"
import { VoiceRegionEvidenceError } from "./errors.js"
import type { ScopePolicy } from "./policy.js"
import type { RequestOptions } from "./types.js"

const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const REGION_KEYS = [
  "custom",
  "deprecated",
  "id",
  "name",
  "optimal",
  "unknownFieldCount",
] as const

export interface VoiceRegionInventoryResult {
  inventory: {
    completeness: "complete"
    returned: number
  }
  privacy: {
    persistence: "none"
    rawPayloads: "omitted"
    text: "transient-untrusted"
    unknownFields: "counts-only"
  }
  regions: DiscordVoiceRegion[]
  schemaVersion: number
  scope: {
    guildId: string | null
    kind: "global" | "guild"
  }
  status: "ok"
}

export interface VoiceRegionServiceClient extends Pick<
  DiscordClient,
  "listGuildVoiceRegions" | "listVoiceRegions"
> {}

export interface VoiceRegionServiceOptions {
  client: VoiceRegionServiceClient
  policy: Pick<ScopePolicy, "assertGuildAllowed">
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function exactRegions(value: DiscordVoiceRegion[]): DiscordVoiceRegion[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.voiceRegions) {
    throw new VoiceRegionEvidenceError("Discord returned invalid voice-region evidence")
  }
  const seen = new Set<string>()
  const regions = value.map((region) => {
    if (
      !region
      || typeof region !== "object"
      || Array.isArray(region)
      || Object.keys(region).some((key) => !REGION_KEYS.includes(
        key as typeof REGION_KEYS[number],
      ))
      || typeof region.id !== "string"
      || region.id.length < 1
      || region.id.length > DISCORD_LIMITS.voiceRegionIdCharacters
      || region.id.trim() !== region.id
      || CONTROL_PATTERN.test(region.id)
      || !validUnicode(region.id)
      || typeof region.name !== "string"
      || region.name.length < 1
      || region.name.length > DISCORD_LIMITS.voiceRegionNameCharacters
      || region.name.trim() !== region.name
      || CONTROL_PATTERN.test(region.name)
      || !validUnicode(region.name)
      || typeof region.custom !== "boolean"
      || typeof region.deprecated !== "boolean"
      || typeof region.optimal !== "boolean"
      || !Number.isSafeInteger(region.unknownFieldCount)
      || region.unknownFieldCount < 0
      || seen.has(region.id)
    ) throw new VoiceRegionEvidenceError("Discord returned invalid voice-region evidence")
    seen.add(region.id)
    return {
      custom: region.custom,
      deprecated: region.deprecated,
      id: region.id,
      name: region.name,
      optimal: region.optimal,
      unknownFieldCount: region.unknownFieldCount,
    }
  })
  return regions.sort((left, right) => (
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  ))
}

function result(
  regions: DiscordVoiceRegion[],
  guildId: string | null,
): VoiceRegionInventoryResult {
  const exact = exactRegions(regions)
  return {
    inventory: {
      completeness: "complete",
      returned: exact.length,
    },
    privacy: {
      persistence: "none",
      rawPayloads: "omitted",
      text: "transient-untrusted",
      unknownFields: "counts-only",
    },
    regions: exact,
    schemaVersion: SCHEMA_VERSION,
    scope: {
      guildId,
      kind: guildId === null ? "global" : "guild",
    },
    status: "ok",
  }
}

export class VoiceRegionService {
  readonly #client: VoiceRegionServiceClient
  readonly #policy: VoiceRegionServiceOptions["policy"]

  constructor(options: VoiceRegionServiceOptions) {
    this.#client = options.client
    this.#policy = options.policy
  }

  async listGlobal(
    options: RequestOptions = {},
  ): Promise<VoiceRegionInventoryResult> {
    return result(await this.#client.listVoiceRegions(options), null)
  }

  async listGuild(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<VoiceRegionInventoryResult> {
    this.#policy.assertGuildAllowed(guildId)
    return result(await this.#client.listGuildVoiceRegions(guildId, options), guildId)
  }
}
