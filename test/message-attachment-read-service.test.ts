import assert from "node:assert/strict"
import test from "node:test"

import {
  AttachmentReadDeliveryError,
  AttachmentReadEvidenceError,
  AttachmentReadTooLargeError,
} from "../src/errors.js"
import {
  maxMessageAttachmentBytesForMcp,
  MessageAttachmentReadService,
  MESSAGE_ATTACHMENT_READ_LIMITS,
  type MessageAttachmentReadServiceClient,
} from "../src/message-attachment-read-service.js"
import type {
  DiscordAttachment,
  DiscordChannel,
  DiscordMessage,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const GUILD_ID = "300000000000000001"
const CHANNEL_ID = "400000000000000001"
const MESSAGE_ID = "500000000000000001"
const ATTACHMENT_ID = "600000000000000001"
const FILENAME = "private-image.gif"
const SIGNATURE = "a".repeat(64)
const SIGNED_URL = `https://cdn.discordapp.com/attachments/${CHANNEL_ID}/${ATTACHMENT_ID}/${FILENAME}?ex=ffffffff&is=00000001&hm=${SIGNATURE}`
const GIF_BYTES = new TextEncoder().encode("GIF89a-private")

function channel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: "private-channel",
    type: 0,
    ...overrides,
  }
}

function attachment(
  overrides: Partial<DiscordAttachment> = {},
): DiscordAttachment {
  return {
    content_type: "image/gif",
    description: "Private description",
    filename: FILENAME,
    height: 32,
    id: ATTACHMENT_ID,
    proxy_url: "https://media.discordapp.net/private",
    size: GIF_BYTES.byteLength,
    url: SIGNED_URL,
    width: 64,
    ...overrides,
  }
}

function message(
  attachments: DiscordAttachment[] = [attachment()],
  overrides: Partial<DiscordMessage> = {},
): DiscordMessage {
  return {
    attachments,
    author: {
      id: "700000000000000001",
      username: "private-author",
    },
    channel_id: CHANNEL_ID,
    content: "private-message",
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
    timestamp: "2026-08-28T00:00:00.000Z",
    type: 0,
    ...overrides,
  }
}

function response(
  bytes: Uint8Array = GIF_BYTES,
  options: {
    contentEncoding?: string
    contentLength?: string | null
    contentType?: string | null
    status?: number
  } = {},
): Response {
  const headers = new Headers()
  if (options.contentLength !== null) {
    headers.set("content-length", options.contentLength ?? String(bytes.byteLength))
  }
  if (options.contentType !== null) {
    headers.set("content-type", options.contentType ?? "image/gif")
  }
  if (options.contentEncoding) headers.set("content-encoding", options.contentEncoding)
  return new Response(bytes, {
    headers,
    status: options.status ?? 200,
  })
}

function fixture(options: {
  channel?: DiscordChannel
  fetchImplementation?: typeof fetch
  message?: DiscordMessage
  policyError?: Error
  response?: Response
} = {}) {
  const calls = {
    channel: 0,
    fetch: 0,
    message: 0,
    policy: 0,
  }
  let fetchInput: unknown
  let fetchInit: RequestInit | undefined
  let channelOptions: unknown
  let messageOptions: unknown
  const client: MessageAttachmentReadServiceClient = {
    async getChannel(channelId, requestOptions) {
      calls.channel += 1
      assert.equal(channelId, CHANNEL_ID)
      channelOptions = requestOptions
      return structuredClone(options.channel ?? channel())
    },
    async getMessage(channelId, messageId, requestOptions) {
      calls.message += 1
      assert.equal(channelId, CHANNEL_ID)
      assert.equal(messageId, MESSAGE_ID)
      messageOptions = requestOptions
      return structuredClone(options.message ?? message())
    },
  }
  const fetchImplementation: typeof fetch = options.fetchImplementation ?? (async (
    input,
    init,
  ) => {
    calls.fetch += 1
    fetchInput = input
    fetchInit = init
    return options.response ?? response()
  })
  const service = new MessageAttachmentReadService({
    client,
    fetchImplementation,
    policy: {
      assertChannelReadable(value) {
        calls.policy += 1
        assert.equal(value.id, CHANNEL_ID)
        if (options.policyError) throw options.policyError
        return GUILD_ID
      },
    },
  })
  return {
    calls,
    getChannelOptions: () => channelOptions,
    getFetchInit: () => fetchInit,
    getFetchInput: () => fetchInput,
    getMessageOptions: () => messageOptions,
    service,
  }
}

async function read(
  service: MessageAttachmentReadService,
  options: { maxBytes?: number; signal?: AbortSignal } = {},
) {
  return service.read(
    APPLICATION_ID,
    BOT_ID,
    CHANNEL_ID,
    MESSAGE_ID,
    ATTACHMENT_ID,
    {
      maxBytes: options.maxBytes ?? 1_024,
      ...(options.signal ? { signal: options.signal } : {}),
    },
  )
}

test("message attachment read binds exact Discord and signed CDN evidence without credentials", async () => {
  const controller = new AbortController()
  const { calls, getChannelOptions, getFetchInit, getFetchInput, getMessageOptions, service } = fixture()

  const result = await read(service, { signal: controller.signal })

  assert.equal(result.applicationId, APPLICATION_ID)
  assert.equal(result.botId, BOT_ID)
  assert.equal(result.guildId, GUILD_ID)
  assert.equal(result.channelId, CHANNEL_ID)
  assert.equal(result.messageId, MESSAGE_ID)
  assert.deepEqual(result.attachment, {
    contentType: "image/gif",
    deliveredMimeType: "image/gif",
    deliveryContentType: "image/gif",
    description: "Private description",
    filename: FILENAME,
    height: 32,
    id: ATTACHMENT_ID,
    representation: "image",
    size: GIF_BYTES.byteLength,
    unknownFieldCount: 0,
    width: 64,
  })
  assert.deepEqual(result.bytes, GIF_BYTES)
  assert.deepEqual(result.privacy, {
    attachmentUrl: "omitted",
    localPath: "none",
    persistence: "none",
    rawPayloads: "omitted",
  })
  assert.deepEqual(result.verification, {
    byteCount: "exact",
    contentType: "matched",
    signedUrl: "exact-bound",
  })
  assert.equal(getFetchInput(), SIGNED_URL)
  assert.deepEqual(getChannelOptions(), { signal: controller.signal })
  assert.deepEqual(getMessageOptions(), { signal: controller.signal })
  const init = getFetchInit()
  assert.equal(init?.cache, "no-store")
  assert.equal(init?.credentials, "omit")
  assert.equal(init?.method, "GET")
  assert.equal(init?.redirect, "manual")
  assert.equal(init?.referrerPolicy, "no-referrer")
  assert.equal(init?.signal, controller.signal)
  const headers = new Headers(init?.headers)
  assert.equal(headers.get("accept-encoding"), "identity")
  assert.equal(headers.has("authorization"), false)
  assert.deepEqual(calls, { channel: 1, fetch: 1, message: 1, policy: 1 })
  assert.doesNotMatch(JSON.stringify({ ...result, bytes: [] }), /cdn|hm=|proxy/u)
})

test("message attachment read uses safe native signatures and octet-stream fallback", async () => {
  const cases: Array<{
    bytes: Uint8Array
    contentType: string | null
    deliveredMimeType: string
    representation: "audio" | "blob" | "image"
  }> = [
    { bytes: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), contentType: "image/png", deliveredMimeType: "image/png", representation: "image" },
    { bytes: new Uint8Array([0xFF, 0xD8, 0xFF, 0x00]), contentType: "image/jpeg", deliveredMimeType: "image/jpeg", representation: "image" },
    { bytes: new TextEncoder().encode("RIFF0000WEBP"), contentType: "image/webp", deliveredMimeType: "image/webp", representation: "image" },
    { bytes: new TextEncoder().encode("ID3private"), contentType: "audio/mpeg", deliveredMimeType: "audio/mpeg", representation: "audio" },
    { bytes: new TextEncoder().encode("OggSprivate"), contentType: "audio/ogg", deliveredMimeType: "audio/ogg", representation: "audio" },
    { bytes: new TextEncoder().encode("RIFF0000WAVE"), contentType: "audio/x-wav", deliveredMimeType: "audio/wav", representation: "audio" },
    { bytes: new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]), contentType: "audio/mp4", deliveredMimeType: "audio/mp4", representation: "audio" },
    { bytes: new Uint8Array([0x1A, 0x45, 0xDF, 0xA3]), contentType: "audio/webm", deliveredMimeType: "audio/webm", representation: "audio" },
    { bytes: new TextEncoder().encode("<script>private</script>"), contentType: "text/html", deliveredMimeType: "application/octet-stream", representation: "blob" },
    { bytes: new Uint8Array([1, 2, 3]), contentType: null, deliveredMimeType: "application/octet-stream", representation: "blob" },
  ]

  for (const item of cases) {
    const metadataContentType = item.contentType
    const observedContentType = metadataContentType ?? "application/octet-stream"
    const { service } = fixture({
      message: message([attachment({
        content_type: metadataContentType,
        size: item.bytes.byteLength,
      })]),
      response: response(item.bytes, { contentType: observedContentType }),
    })
    const result = await read(service)
    assert.equal(result.attachment.representation, item.representation)
    assert.equal(result.attachment.deliveredMimeType, item.deliveredMimeType)
    assert.equal(result.attachment.deliveryContentType, observedContentType)
    assert.equal(
      result.verification.contentType,
      metadataContentType === null ? "response-only" : "matched",
    )
  }
})

test("message attachment read rejects local input and scope before protected reads", async () => {
  const { calls, service } = fixture()
  await assert.rejects(
    service.read(APPLICATION_ID, BOT_ID, "bad", MESSAGE_ID, ATTACHMENT_ID, { maxBytes: 1_024 }),
    /channel ID/,
  )
  assert.deepEqual(calls, { channel: 0, fetch: 0, message: 0, policy: 0 })

  const mismatched = fixture({ channel: channel({ id: BOT_ID }) })
  await assert.rejects(
    read(mismatched.service),
    /different attachment-read channel/u,
  )
  assert.deepEqual(mismatched.calls, { channel: 1, fetch: 0, message: 0, policy: 0 })

  const denied = new Error("scope denied")
  const scoped = fixture({ policyError: denied })
  await assert.rejects(read(scoped.service), denied)
  assert.deepEqual(scoped.calls, { channel: 1, fetch: 0, message: 0, policy: 1 })
})

test("message attachment read rejects missing, duplicate, malformed, and oversized evidence before delivery", async () => {
  const cases: DiscordMessage[] = [
    message([]),
    message([attachment(), attachment()]),
    message([attachment({ id: "bad" })]),
    message([attachment({ filename: "../private.gif" })]),
    message([attachment({ size: 1_025 })]),
    message([attachment({ url: SIGNED_URL.replace("cdn.discordapp.com", "example.com") })]),
    message([attachment({ url: SIGNED_URL.replace(CHANNEL_ID, GUILD_ID) })]),
    message([attachment({ url: SIGNED_URL.replace(ATTACHMENT_ID, BOT_ID) })]),
    message([attachment({ url: SIGNED_URL.replace(FILENAME, "other.gif") })]),
    message([attachment({ url: SIGNED_URL.replace("/attachments/", "/attachments//") })]),
    message([attachment({ url: SIGNED_URL.replace(`/${FILENAME}?`, `/${FILENAME}/?`) })]),
    message([attachment({ url: SIGNED_URL.replace("https://", "http://") })]),
    message([attachment({ url: SIGNED_URL.replace("https://", "https://private@") })]),
    message([attachment({ url: `${SIGNED_URL}#private` })]),
    message([attachment({ url: SIGNED_URL.replace("?ex=", "?ex=ffffffff&ex=") })]),
    message([attachment({ url: SIGNED_URL.replace("ex=ffffffff&is=00000001", "ex=00000001&is=ffffffff") })]),
    message([attachment({ url: SIGNED_URL.replace(SIGNATURE, SIGNATURE.toUpperCase()) })]),
    message([attachment({ url: `${SIGNED_URL}&extra=private` })]),
  ]
  for (const evidence of cases) {
    const { calls, service } = fixture({ message: evidence })
    await assert.rejects(
      read(service),
      (error: unknown) => (
        error instanceof AttachmentReadEvidenceError
        || error instanceof AttachmentReadTooLargeError
      ),
    )
    assert.equal(calls.fetch, 0)
  }
})

test("message attachment read accepts an exact signed ephemeral attachment route", async () => {
  const ephemeralUrl = SIGNED_URL.replace(
    "/attachments/",
    "/ephemeral-attachments/",
  )
  const { getFetchInput, service } = fixture({
    message: message([attachment({ url: ephemeralUrl })]),
  })

  const result = await read(service)

  assert.equal(getFetchInput(), ephemeralUrl)
  result.bytes.fill(0)
})

test("message attachment read fails closed on delivery status, headers, length, expansion, and media mismatch", async () => {
  const cases: Array<{ attachment?: DiscordAttachment; response: Response }> = [
    { response: response(GIF_BYTES, { status: 302 }) },
    { response: response(GIF_BYTES, { contentType: null }) },
    { response: response(GIF_BYTES, { contentEncoding: "gzip" }) },
    { response: response(GIF_BYTES, { contentType: "image/png" }) },
    { response: response(GIF_BYTES, { contentLength: "999" }) },
    { response: response(GIF_BYTES.subarray(0, GIF_BYTES.length - 1), { contentLength: null }) },
    {
      attachment: attachment({ size: GIF_BYTES.length - 1 }),
      response: response(GIF_BYTES, { contentLength: null }),
    },
    {
      attachment: attachment({ content_type: "image/png" }),
      response: response(GIF_BYTES, { contentType: "image/png" }),
    },
  ]
  for (const item of cases) {
    const { service } = fixture({
      ...(item.attachment ? { message: message([item.attachment]) } : {}),
      response: item.response,
    })
    await assert.rejects(
      read(service),
      (error: unknown) => (
        error instanceof AttachmentReadDeliveryError
        || error instanceof AttachmentReadEvidenceError
      ),
    )
  }
})

test("message attachment read preserves cancellation and sanitizes network failures", async () => {
  const aborted = fixture({
    fetchImplementation: async () => {
      throw new DOMException("private abort detail", "AbortError")
    },
  })
  await assert.rejects(
    read(aborted.service),
    (error: unknown) => (
      error instanceof Error
      && error.name === "AbortError"
      && error.message === "Discord attachment read was canceled"
    ),
  )

  const failed = fixture({
    fetchImplementation: async () => {
      throw new Error(`private network detail ${SIGNED_URL}`)
    },
  })
  await assert.rejects(
    read(failed.service),
    (error: unknown) => {
      assert.ok(error instanceof AttachmentReadDeliveryError)
      assert.equal(error.message, "Discord attachment delivery failed")
      assert.equal(error.cause, undefined)
      return true
    },
  )
})

test("message attachment read sanitizes body failures and wipes streamed custody", async () => {
  const firstChunk = new TextEncoder().encode("GIF89a")
  let pullCount = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pullCount += 1
      if (pullCount === 1) {
        controller.enqueue(firstChunk)
        return
      }
      controller.error(new Error(`private body detail ${SIGNED_URL}`))
    },
  })
  const headers = new Headers({
    "content-type": "image/gif",
  })
  const { service } = fixture({
    response: new Response(body, { headers }),
  })

  await assert.rejects(
    read(service),
    (error: unknown) => {
      assert.ok(error instanceof AttachmentReadDeliveryError)
      assert.equal(error.message, "Discord attachment delivery failed")
      assert.equal(error.cause, undefined)
      return true
    },
  )
  assert.deepEqual(firstChunk, new Uint8Array(firstChunk.byteLength))
})

test("message attachment read wipes an expanding chunk and preserves its fixed error when cancellation fails", async () => {
  const expandedChunk = new TextEncoder().encode("GIF89a-private-expanded")
  let cancelCalls = 0
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelCalls += 1
      throw new Error(`private cancellation detail ${SIGNED_URL}`)
    },
    start(controller) {
      controller.enqueue(expandedChunk)
    },
  })
  const declaredSize = expandedChunk.byteLength - 1
  const { service } = fixture({
    message: message([attachment({ size: declaredSize })]),
    response: new Response(body, {
      headers: { "content-type": "image/gif" },
    }),
  })

  await assert.rejects(
    read(service),
    (error: unknown) => (
      error instanceof AttachmentReadEvidenceError
      && error.message === "Discord attachment delivery exceeded its declared size"
    ),
  )
  assert.equal(cancelCalls, 1)
  assert.deepEqual(expandedChunk, new Uint8Array(expandedChunk.byteLength))
})

test("message attachment byte limits derive conservatively from the MCP response budget", () => {
  assert.equal(maxMessageAttachmentBytesForMcp(64 * 1_024), 36_864)
  assert.equal(maxMessageAttachmentBytesForMcp(1_024 * 1_024), 774_144)
  assert.equal(
    maxMessageAttachmentBytesForMcp(64 * 1_024 * 1_024),
    MESSAGE_ATTACHMENT_READ_LIMITS.maximumBytes,
  )
  assert.throws(() => maxMessageAttachmentBytesForMcp(1), /too small/)
})
