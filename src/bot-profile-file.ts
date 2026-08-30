import { CONNECTOR_LIMITS } from "./constants.js"
import {
  type DiscordImageDataDetails,
  type DiscordImageDataFormat,
  GuildExpressionFileError,
  inspectDiscordImageDataBytes,
} from "./guild-expression-file.js"
import {
  OwnedLocalFileError,
  readOwnedLocalFileSnapshot,
  type OwnedLocalFileSnapshot,
} from "./local-file.js"

export type BotProfileImageFormat = DiscordImageDataFormat

export interface BotProfileImageFileReview extends DiscordImageDataDetails {
  canonicalPath: string
  containedByConfiguredRoot: true
  ownerMatchesProcess: true
  regularFile: true
  singleLink: true
  sizeBytes: number
  stableRead: true
}

export interface BotProfileImageFileSnapshot extends Omit<
  OwnedLocalFileSnapshot,
  "review"
> {
  review: BotProfileImageFileReview
}

export interface ReadBotProfileImageFileOptions {
  filePath: string
  kind: "avatar" | "banner"
  planKey: Uint8Array
  roots: readonly string[]
}

export class BotProfileImageFileError extends Error {
  override name = "BotProfileImageFileError"
}

export async function readBotProfileImageFileSnapshot(
  options: ReadBotProfileImageFileOptions,
): Promise<BotProfileImageFileSnapshot> {
  if (options.kind !== "avatar" && options.kind !== "banner") {
    throw new RangeError("Discord bot-profile image kind must be avatar or banner")
  }
  const description = `Discord bot-profile ${options.kind}`
  let snapshot: OwnedLocalFileSnapshot
  try {
    snapshot = await readOwnedLocalFileSnapshot({
      description,
      digestDomain: `guildcontrol-bot-profile-${options.kind}.v1`,
      filePath: options.filePath,
      maxBytes: CONNECTOR_LIMITS.botProfileImageBytes,
      planKey: options.planKey,
      roots: options.roots,
    })
  } catch (error) {
    if (error instanceof OwnedLocalFileError) {
      throw new BotProfileImageFileError(error.message, { cause: error })
    }
    throw error
  }
  let details: DiscordImageDataDetails
  try {
    details = inspectDiscordImageDataBytes(snapshot.bytes)
  } catch (error) {
    if (error instanceof GuildExpressionFileError) {
      throw new BotProfileImageFileError(
        `Discord bot-profile ${options.kind} must be valid JPEG, PNG, or GIF image data`,
        { cause: error },
      )
    }
    throw error
  }
  return {
    binding: snapshot.binding,
    bytes: snapshot.bytes,
    contentDigest: snapshot.contentDigest,
    review: {
      ...snapshot.review,
      ...details,
    },
  }
}
