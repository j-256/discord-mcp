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
  try {
    return await readOwnedLocalFileSnapshot({
      ...options,
      description: "Discord attachment",
      digestDomain: "discord-mcp-attachment-file.v1",
    })
  } catch (error) {
    if (error instanceof OwnedLocalFileError) {
      throw new AttachmentFileError(error.message, { cause: error })
    }
    throw error
  }
}
