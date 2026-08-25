import {
  OwnedLocalFileError,
  readOwnedLocalFileSnapshot,
  type OwnedLocalFileReview,
  type OwnedLocalFileSnapshot,
} from "./local-file.js"

export type AttachmentFileReview = OwnedLocalFileReview
export type AttachmentFileSnapshot = OwnedLocalFileSnapshot

export interface ReadAttachmentFileOptions {
  filePath: string
  maxBytes: number
  planKey: Uint8Array
  roots: readonly string[]
}

export class AttachmentFileError extends Error {
  override name = "AttachmentFileError"
}

export async function readAttachmentFileSnapshot(
  options: ReadAttachmentFileOptions,
): Promise<AttachmentFileSnapshot> {
  return readSnapshot(
    options,
    "Discord attachment",
    "discord-mcp-attachment-file.v1",
  )
}

export async function readDirectAttachmentFileSnapshot(
  options: ReadAttachmentFileOptions,
): Promise<AttachmentFileSnapshot> {
  return readSnapshot(
    options,
    "Discord direct-message attachment",
    "discord-mcp-direct-attachment-file.v1",
  )
}

async function readSnapshot(
  options: ReadAttachmentFileOptions,
  description: string,
  digestDomain: string,
): Promise<AttachmentFileSnapshot> {
  try {
    return await readOwnedLocalFileSnapshot({
      ...options,
      description,
      digestDomain,
    })
  } catch (error) {
    if (error instanceof OwnedLocalFileError) {
      throw new AttachmentFileError(error.message, { cause: error })
    }
    throw error
  }
}
