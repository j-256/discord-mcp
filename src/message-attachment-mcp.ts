import { AttachmentReadWithheldError } from "./errors.js"
import type { MessageAttachmentReadResult } from "./message-attachment-read-service.js"

export interface EncodedMessageAttachment {
  data: string
  metadata: Omit<MessageAttachmentReadResult, "bytes">
  uri: string
}

export function messageAttachmentResourceUri(
  channelId: string,
  messageId: string,
  attachmentId: string,
): string {
  return `discord://channels/${channelId}/messages/${messageId}/attachments/${attachmentId}`
}

function rawBytesContainSecret(
  bytes: Uint8Array,
  secrets: readonly (string | undefined)[],
): boolean {
  const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return secrets.some((secret) => (
    Boolean(secret)
    && source.includes(Buffer.from(secret as string, "utf8"))
  ))
}

export function encodeMessageAttachmentForMcp(
  result: MessageAttachmentReadResult,
  secrets: readonly (string | undefined)[],
): EncodedMessageAttachment {
  const { bytes, ...metadata } = result
  try {
    if (rawBytesContainSecret(bytes, secrets)) {
      throw new AttachmentReadWithheldError(
        "Discord attachment delivery was withheld by the connector safety boundary",
      )
    }
    return {
      data: Buffer.from(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      ).toString("base64"),
      metadata,
      uri: messageAttachmentResourceUri(
        result.channelId,
        result.messageId,
        result.attachment.id,
      ),
    }
  } finally {
    bytes.fill(0)
  }
}
