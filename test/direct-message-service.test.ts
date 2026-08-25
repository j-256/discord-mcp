import assert from "node:assert/strict"
import {
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import {
  DISCORD_MESSAGE_FLAGS,
  DISCORD_MESSAGE_REFERENCE_TYPES,
  DISCORD_MESSAGE_TYPES,
} from "../src/constants.js"
import {
  DirectMessageService,
  directMessageRequestDigest,
  directMessageVerificationKey,
  normalizeDirectMessageChangeRequest,
  type DirectMessageChangeRequest,
  type DirectMessageComponentBody,
  type DirectMessageServiceClient,
} from "../src/direct-message-service.js"
import {
  DirectMessageEvidenceError,
  DirectMessageExecutionError,
  DirectMessageOperationConflictError,
  DirectMessagePlanChangedError,
  DiscordApiError,
  InteractionRateLimitError,
  PolicyError,
} from "../src/errors.js"
import { InteractionLimiter } from "../src/interaction-limiter.js"
import {
  FileOperationStore,
  operationKeyHash,
  type DirectMessageOperationReceipt,
  type DirectMessageOperationStore,
} from "../src/operation-store.js"
import { ScopePolicy } from "../src/policy.js"
import type { DiscordMessage } from "../src/types.js"
import type {
  WriteCoordinationIntent,
  WriteCoordinator,
} from "../src/write-coordination.js"
import { loadFixtureConfig } from "./config-fixture.js"

const APPLICATION_ID = "900000000000000001"
const BOT_ID = "900000000000000002"
const RECIPIENT_ID = "900000000000000003"
const OTHER_RECIPIENT_ID = "900000000000000004"
const CHANNEL_ID = "900000000000000005"
const MESSAGE_ID = "900000000000000006"
const RESULT_MESSAGE_ID = "900000000000000007"
const TOKEN = "test-direct-message-token"
const OPERATION_KEY = "direct-message-operation-key"
const TIMESTAMP = "2026-08-25T12:00:00.000Z"
const COMPONENT_TEXT = "private component marker"

class MemoryActivityStore implements ActivityStore {
  readonly entries: ActivityEntry[] = []

  async append(entry: ActivityEntry): Promise<void> {
    this.entries.push(entry)
  }

  async list() {
    return {
      entries: [...this.entries],
      file: "/memory/activity.jsonl",
      skippedLines: 0,
    }
  }
}

class SelectiveActivityStore extends MemoryActivityStore {
  #appendCount = 0
  readonly #fail: (entry: ActivityEntry, appendCount: number) => boolean

  constructor(fail: (entry: ActivityEntry, appendCount: number) => boolean) {
    super()
    this.#fail = fail
  }

  override async append(entry: ActivityEntry): Promise<void> {
    this.#appendCount += 1
    if (this.#fail(entry, this.#appendCount)) {
      throw new Error("private activity sink failed")
    }
    await super.append(entry)
  }
}

const PASSTHROUGH_COORDINATOR: WriteCoordinator = {
  async run<T>(_intent: unknown, operation: () => Promise<T>): Promise<T> {
    return operation()
  },
}

function policy(capabilities: {
  attachments?: boolean
  audit?: boolean
  deletion?: boolean
  delivery?: boolean
  editing?: boolean
} = {}, attachmentRoots: readonly string[] = []): ScopePolicy {
  return new ScopePolicy(loadFixtureConfig({
    capabilities: {
      directMessageAudit: capabilities.audit ?? false,
      directMessageAttachments: capabilities.attachments ?? false,
      directMessageDeletion: capabilities.deletion ?? false,
      directMessageDelivery: capabilities.delivery ?? false,
      directMessageEditing: capabilities.editing ?? false,
    },
    scopes: {
      directMessageUserIds: [RECIPIENT_ID],
    },
    storage: { attachmentRoots },
    token: TOKEN,
  }))
}

function rawMessage(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    author: {
      bot: true,
      id: BOT_ID,
      username: "Connector Profile",
    },
    channel_id: CHANNEL_ID,
    content: "private secret marker",
    id: MESSAGE_ID,
    timestamp: TIMESTAMP,
    type: 0,
    ...overrides,
  }
}

function componentBody(content = COMPONENT_TEXT): DirectMessageComponentBody {
  return {
    components: [{
      accentColor: 0x12_34_56,
      components: [
        { content, kind: "text" },
        { divider: true, kind: "separator", spacing: "large" },
      ],
      kind: "container",
      spoiler: false,
    }, {
      content: "private component footer",
      kind: "text",
    }],
    kind: "components-v2",
  }
}

function rawComponentMessage(
  content = COMPONENT_TEXT,
  overrides: Partial<DiscordMessage> = {},
): DiscordMessage {
  return rawMessage({
    components: [{
      accent_color: 0x12_34_56,
      components: [
        { content, id: 2, type: 10 },
        { divider: true, id: 3, spacing: 2, type: 14 },
      ],
      id: 1,
      spoiler: false,
      type: 17,
    }, {
      content: "private component footer",
      id: 4,
      type: 10,
    }],
    content: "",
    flags: DISCORD_MESSAGE_FLAGS.isComponentsV2,
    ...overrides,
  })
}

function rawAttachmentMessage(options: {
  content?: string
  description?: string
  filename?: string
  messageId?: string
  replyToMessageId?: string
  sizeBytes?: number
} = {}, overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  const replyToMessageId = options.replyToMessageId
  return rawMessage({
    attachments: [{
      content_type: "application/octet-stream",
      ...(options.description === undefined
        ? {}
        : { description: options.description }),
      filename: options.filename ?? "report.txt",
      id: "900000000000000008",
      proxy_url: "https://media.discord.test/private-proxy",
      size: options.sizeBytes ?? 22,
      url: "https://cdn.discord.test/private-file",
    }],
    content: options.content ?? "",
    id: options.messageId ?? MESSAGE_ID,
    ...(replyToMessageId === undefined
      ? {}
      : {
          message_reference: {
            channel_id: CHANNEL_ID,
            message_id: replyToMessageId,
            type: DISCORD_MESSAGE_REFERENCE_TYPES.default,
          },
          type: DISCORD_MESSAGE_TYPES.reply,
        }),
    ...overrides,
  })
}

function clientFixture(options: {
  calls?: string[]
  message?: DiscordMessage
  recipientBot?: boolean
} = {}): DirectMessageServiceClient {
  const calls = options.calls ?? []
  const message = options.message ?? rawMessage()
  return {
    async createDirectAttachmentMessage() {
      calls.push("create-attachment-message")
      return message
    },
    async createDirectComponentMessage() {
      calls.push("create-component-message")
      return message
    },
    async createDirectMessage() {
      calls.push("create-message")
      return message
    },
    async createDirectMessageChannel(recipientId) {
      calls.push("create-channel")
      return {
        id: CHANNEL_ID,
        recipient: {
          bot: options.recipientBot ?? false,
          id: recipientId,
          system: false,
          unknownFieldCount: 0,
        },
        type: 1,
        unknownFieldCount: 0,
      }
    },
    async deleteDirectMessage() {
      calls.push("delete-message")
    },
    async editDirectMessage() {
      calls.push("edit-message")
      return message
    },
    async editDirectComponentMessage() {
      calls.push("edit-component-message")
      return message
    },
    async getCurrentApplication() {
      calls.push("get-application")
      return {
        bot: { bot: true, id: BOT_ID, username: "Connector Profile" },
        description: "private application description",
        id: APPLICATION_ID,
        name: "Private Application",
      }
    },
    async getCurrentUser() {
      calls.push("get-current-user")
      return { bot: true, id: BOT_ID, username: "Connector Profile" }
    },
    async getDirectMessage() {
      calls.push("get-message")
      return message
    },
    async getDirectMessageChannel(_channelId, recipientId) {
      calls.push("get-channel")
      return {
        id: CHANNEL_ID,
        recipient: {
          bot: options.recipientBot ?? false,
          id: recipientId,
          system: false,
          unknownFieldCount: 0,
        },
        type: 1,
        unknownFieldCount: 0,
      }
    },
    async getDirectMessageUser(userId) {
      calls.push("get-user")
      return {
        bot: options.recipientBot ?? false,
        id: userId,
        system: false,
        unknownFieldCount: 3,
      }
    },
    async listDirectMessages() {
      calls.push("list-messages")
      return [message]
    },
  }
}

function sendRequest(content = "private secret marker"): DirectMessageChangeRequest {
  return {
    acknowledgeExpectedRecipientContact: true,
    action: "send",
    message: { content, kind: "text" },
    operationKey: OPERATION_KEY,
    recipientId: RECIPIENT_ID,
    reviewReason: "operator private reason",
  }
}

function replyRequest(content = "private reply marker"): DirectMessageChangeRequest {
  return {
    acknowledgeExpectedRecipientContact: true,
    action: "reply",
    channelId: CHANNEL_ID,
    message: { content, kind: "text" },
    operationKey: `${OPERATION_KEY}-reply`,
    recipientId: RECIPIENT_ID,
    replyToMessageId: MESSAGE_ID,
    reviewReason: "review exact private reply",
  }
}

function editRequest(content = "private replacement marker"): DirectMessageChangeRequest {
  return {
    action: "edit",
    channelId: CHANNEL_ID,
    message: { content, kind: "text" },
    messageId: MESSAGE_ID,
    operationKey: `${OPERATION_KEY}-edit`,
    recipientId: RECIPIENT_ID,
    reviewReason: "review exact private edit",
  }
}

function componentSendRequest(
  content = COMPONENT_TEXT,
): DirectMessageChangeRequest {
  return {
    acknowledgeExpectedRecipientContact: true,
    action: "send",
    message: componentBody(content),
    operationKey: `${OPERATION_KEY}-components-send`,
    recipientId: RECIPIENT_ID,
    reviewReason: "review exact static private layout",
  }
}

function componentReplyRequest(
  content = COMPONENT_TEXT,
): DirectMessageChangeRequest {
  return {
    acknowledgeExpectedRecipientContact: true,
    action: "reply",
    channelId: CHANNEL_ID,
    message: componentBody(content),
    operationKey: `${OPERATION_KEY}-components-reply`,
    recipientId: RECIPIENT_ID,
    replyToMessageId: MESSAGE_ID,
    reviewReason: "review exact static private reply layout",
  }
}

function componentEditRequest(
  content = "private replacement component marker",
): DirectMessageChangeRequest {
  return {
    action: "edit",
    channelId: CHANNEL_ID,
    message: componentBody(content),
    messageId: MESSAGE_ID,
    operationKey: `${OPERATION_KEY}-components-edit`,
    recipientId: RECIPIENT_ID,
    reviewReason: "review exact static private edit layout",
  }
}

function attachmentSendRequest(filePath: string): DirectMessageChangeRequest {
  return {
    acknowledgeExpectedRecipientContact: true,
    action: "send",
    message: {
      content: "Requested private report attached",
      description: "Reviewed private report",
      filePath,
      filename: "private-report.txt",
      kind: "attachment",
    },
    operationKey: `${OPERATION_KEY}-attachment-send`,
    recipientId: RECIPIENT_ID,
    reviewReason: "review exact private file delivery",
  }
}

function attachmentReplyRequest(filePath: string): DirectMessageChangeRequest {
  return {
    acknowledgeExpectedRecipientContact: true,
    action: "reply",
    channelId: CHANNEL_ID,
    message: {
      content: "Requested private report attached",
      description: "Reviewed private report",
      filePath,
      filename: "private-report.txt",
      kind: "attachment",
    },
    operationKey: `${OPERATION_KEY}-attachment-reply`,
    recipientId: RECIPIENT_ID,
    replyToMessageId: MESSAGE_ID,
    reviewReason: "review exact private file reply",
  }
}

function deleteRequest(): DirectMessageChangeRequest {
  return {
    acknowledgeIrreversibleDeletion: true,
    action: "delete",
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    operationKey: `${OPERATION_KEY}-delete`,
    recipientId: RECIPIENT_ID,
    reviewReason: "review irreversible private deletion",
  }
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: "private Discord transport detail",
    method: "POST",
    route: "/users/@me/channels",
    status,
  })
}

function wrappedOperationStore(
  base: FileOperationStore,
  overrides: Partial<Pick<
    DirectMessageOperationStore,
    | "checkpointDirectMessage"
    | "finishDirectMessage"
    | "getDirectMessage"
    | "reserveDirectMessage"
  >> = {},
): DirectMessageOperationStore {
  return {
    checkpointDirectMessage: overrides.checkpointDirectMessage
      ?? ((receipt) => base.checkpointDirectMessage(receipt)),
    finish: (receipt) => base.finish(receipt),
    finishDirectMessage: overrides.finishDirectMessage
      ?? ((receipt) => base.finishDirectMessage(receipt)),
    get: (kind, hash) => base.get(kind, hash),
    getDirectMessage: overrides.getDirectMessage
      ?? ((kind, hash) => base.getDirectMessage(kind, hash)),
    reserve: (receipt) => base.reserve(receipt),
    reserveDirectMessage: overrides.reserveDirectMessage
      ?? ((receipt) => base.reserveDirectMessage(receipt)),
  }
}

test("direct-message requests are closed and require action-specific acknowledgement", () => {
  for (const request of [
    sendRequest(),
    replyRequest(),
    editRequest(),
    deleteRequest(),
    componentSendRequest(),
    componentReplyRequest(),
    componentEditRequest(),
  ]) {
    const normalized = normalizeDirectMessageChangeRequest(request)
    assert.equal(normalized.action, request.action)
    assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
    assert.doesNotMatch(JSON.stringify(normalized), /direct-message-operation-key/)
  }
  const normalizedComponents = normalizeDirectMessageChangeRequest(
    componentSendRequest(),
  )
  assert.equal(normalizedComponents.action, "send")
  if (normalizedComponents.message.kind !== "components-v2") {
    assert.fail("Expected a normalized Components V2 body")
  }
  assert.deepEqual(normalizedComponents.message.components[0], {
    accentColor: 0x12_34_56,
    components: [
      { content: COMPONENT_TEXT, kind: "text" },
      { divider: true, kind: "separator", spacing: "large" },
    ],
    kind: "container",
    spoiler: false,
  })
  const attachmentPath = join(tmpdir(), "private-report.txt")
  const attachmentNormalizationRequest: DirectMessageChangeRequest = {
    acknowledgeExpectedRecipientContact: true,
    action: "send",
    message: { filePath: attachmentPath, kind: "attachment" },
    operationKey: `${OPERATION_KEY}-attachment-normalization`,
    recipientId: RECIPIENT_ID,
    reviewReason: "review attachment normalization",
  }
  const normalizedAttachment = normalizeDirectMessageChangeRequest(
    attachmentNormalizationRequest,
  )
  if (
    normalizedAttachment.action !== "send"
    || normalizedAttachment.message.kind !== "attachment"
  ) {
    assert.fail("Expected a normalized attachment body")
  }
  assert.deepEqual(normalizedAttachment.message, {
    content: null,
    description: null,
    filePath: attachmentPath,
    filename: "private-report.txt",
    kind: "attachment",
  })
  assert.throws(
    () => normalizeDirectMessageChangeRequest({
      ...editRequest(),
      message: { filePath: attachmentPath, kind: "attachment" },
    } as unknown as DirectMessageChangeRequest),
    /valid only for send and reply/,
  )
  assert.throws(
    () => normalizeDirectMessageChangeRequest({
      ...attachmentSendRequest(attachmentPath),
      message: {
        filePath: attachmentPath,
        kind: "attachment",
        url: "https://cdn.discord.test/private-file",
      },
    } as unknown as DirectMessageChangeRequest),
    /requires one exact absolute file path/,
  )
  assert.throws(
    () => normalizeDirectMessageChangeRequest({
      ...sendRequest(),
      content: "legacy private body",
    } as unknown as DirectMessageChangeRequest),
    /requires exact body/,
  )
  assert.throws(
    () => normalizeDirectMessageChangeRequest({
      ...sendRequest(),
      message: {
        ...componentBody(),
        content: "mixed private body",
      },
    } as unknown as DirectMessageChangeRequest),
    /requires exact kind and components/,
  )
  assert.throws(
    () => normalizeDirectMessageChangeRequest({
      ...sendRequest(),
      message: {
        components: [{ customId: "unsafe", kind: "button" }],
        kind: "components-v2",
      },
    } as unknown as DirectMessageChangeRequest),
    /kind must be container, separator, or text/,
  )
  assert.throws(
    () => normalizeDirectMessageChangeRequest({
      ...sendRequest(),
      acknowledgeExpectedRecipientContact: false,
    } as unknown as DirectMessageChangeRequest),
    /contact acknowledgement/,
  )
  assert.throws(
    () => normalizeDirectMessageChangeRequest({
      ...sendRequest(),
      userName: "fuzzy target",
    } as unknown as DirectMessageChangeRequest),
    /requires exact body/,
  )
  assert.throws(
    () => normalizeDirectMessageChangeRequest({
      ...deleteRequest(),
      acknowledgeIrreversibleDeletion: false,
    } as unknown as DirectMessageChangeRequest),
    /irreversible acknowledgement/,
  )
  assert.throws(
    () => normalizeDirectMessageChangeRequest({
      ...editRequest(),
      reviewReason: " padded reason ",
    }),
    /review reason/,
  )
  assert.throws(
    () => normalizeDirectMessageChangeRequest({
      ...replyRequest(),
      channelId: "0",
    } as DirectMessageChangeRequest),
    /channel ID/,
  )
  assert.throws(
    () => normalizeDirectMessageChangeRequest([] as unknown as DirectMessageChangeRequest),
    /exact object/,
  )
  assert.throws(
    () => normalizeDirectMessageChangeRequest({
      action: "broadcast",
    } as unknown as DirectMessageChangeRequest),
    /send, reply, edit, or delete/,
  )
  assert.throws(
    () => directMessageVerificationKey("   "),
    /non-empty secret/,
  )
})

test("direct-message send planning remains read-only and profile-minimized", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-plan-"))
  try {
    const calls: string[] = []
    const service = new DirectMessageService({
      activityStore: new MemoryActivityStore(),
      client: clientFixture({ calls }),
      clock: () => new Date(TIMESTAMP),
      operationStore: new FileOperationStore(directory),
      planKey: new Uint8Array(32).fill(7),
      policy: policy({ delivery: true }),
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: PASSTHROUGH_COORDINATOR,
    })

    const plan = await service.plan(
      APPLICATION_ID,
      BOT_ID,
      sendRequest(),
    )

    assert.equal(plan.status, "planned")
    assert.equal(plan.channel, null)
    assert.equal(plan.desired.preview, null)
    assert.deepEqual(calls, ["get-application", "get-current-user", "get-user"])
    assert.doesNotMatch(JSON.stringify(plan), /Private Application|Connector Profile/)
    assert.equal(plan.recipient.id, RECIPIENT_ID)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("direct-message owned-file send and reply bind, upload, and recover without reopening the file", async (t) => {
  for (const action of ["send", "reply"] as const) {
    await t.test(action, async () => {
      const temporary = await mkdtemp(join(tmpdir(), `discord-mcp-dm-attachment-${action}-`))
      try {
        const root = await realpath(temporary)
        const filePath = join(root, "private-report.txt")
        const fileBytes = Buffer.from("reviewed private bytes")
        await writeFile(filePath, fileBytes)
        const request = action === "send"
          ? attachmentSendRequest(filePath)
          : attachmentReplyRequest(filePath)
        const replyTarget = rawMessage({
          author: {
            bot: false,
            id: RECIPIENT_ID,
            username: "Private Recipient",
          },
          content: "private request",
          id: MESSAGE_ID,
        })
        const attachmentMessage = rawAttachmentMessage({
          content: "Requested private report attached",
          description: "Reviewed private report",
          filename: "private-report.txt",
          messageId: RESULT_MESSAGE_ID,
          ...(action === "reply" ? { replyToMessageId: MESSAGE_ID } : {}),
          sizeBytes: fileBytes.byteLength,
        })
        const calls: string[] = []
        let uploadInput: Parameters<
          DirectMessageServiceClient["createDirectAttachmentMessage"]
        >[1] | null = null
        const client: DirectMessageServiceClient = {
          ...clientFixture({ calls, message: attachmentMessage }),
          async createDirectAttachmentMessage(_channelId, input) {
            calls.push("create-attachment-message")
            uploadInput = input
            return attachmentMessage
          },
          async getDirectMessage(_channelId, messageId) {
            calls.push("get-message")
            return messageId === MESSAGE_ID ? replyTarget : attachmentMessage
          },
        }
        const store = new FileOperationStore(join(root, "receipts"))
        const activity = new MemoryActivityStore()
        const service = new DirectMessageService({
          activityStore: activity,
          attachmentMaxBytes: 1_024,
          attachmentRoots: [root],
          client,
          clock: () => new Date(TIMESTAMP),
          operationStore: store,
          planKey: new Uint8Array(32).fill(action === "send" ? 30 : 31),
          policy: policy({ attachments: true, delivery: true }, [root]),
          randomId: () => `direct_message_activity_attachment_${action}`,
          verificationKey: directMessageVerificationKey(TOKEN),
          writeCoordinator: PASSTHROUGH_COORDINATOR,
        })

        const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
        assert.equal(plan.status, "planned")
        assert.equal(plan.file?.canonicalPath, filePath)
        assert.equal(plan.file?.filename, "private-report.txt")
        assert.equal(plan.file?.description, "Reviewed private report")
        assert.equal(plan.file?.sizeBytes, fileBytes.byteLength)
        assert.equal(plan.file?.maxBytes, 1_024)
        assert.equal(plan.file?.ownerMatchesProcess, true)
        assert.equal(plan.file?.singleLink, true)
        assert.equal(plan.file?.stableRead, true)
        assert.equal(calls.includes("create-channel"), false)
        assert.equal(calls.includes("create-attachment-message"), false)
        assert.doesNotMatch(JSON.stringify(plan), /reviewed private bytes|contentDigest|inode/)

        const result = await service.execute(
          APPLICATION_ID,
          BOT_ID,
          request,
          plan.digest,
        )
        assert.equal(result.status, "completed")
        assert.equal(result.messageId, RESULT_MESSAGE_ID)
        assert.equal(
          calls.filter((call) => call === "create-attachment-message").length,
          1,
        )
        assert.equal(
          calls.filter((call) => call === "create-channel").length,
          action === "send" ? 1 : 0,
        )
        assert.deepEqual(uploadInput, {
          bytes: new Uint8Array(fileBytes),
          content: "Requested private report attached",
          description: "Reviewed private report",
          filename: "private-report.txt",
          nonce: (uploadInput as { nonce: string } | null)?.nonce,
          ...(action === "reply" ? { replyToMessageId: MESSAGE_ID } : {}),
        })
        assert.match((uploadInput as { nonce: string } | null)?.nonce ?? "", /^[A-Za-z0-9_-]+$/)

        const receipt = await store.getDirectMessage(
          "direct-message-change",
          operationKeyHash(request.operationKey),
        )
        assert.equal(receipt?.messageFormat, "attachment")
        assert.equal(receipt?.attachmentSizeBytes, fileBytes.byteLength)
        const durable = JSON.stringify({ activity: activity.entries, receipt })
        assert.doesNotMatch(
          durable,
          /private-report|reviewed private|Reviewed private|canonicalPath|contentDigest|filePath/,
        )

        await rm(filePath)
        calls.length = 0
        const recovered = new DirectMessageService({
          activityStore: activity,
          attachmentMaxBytes: 1_024,
          attachmentRoots: [root],
          client,
          operationStore: store,
          policy: policy({ attachments: true, delivery: true }, [root]),
          verificationKey: directMessageVerificationKey(TOKEN),
          writeCoordinator: PASSTHROUGH_COORDINATOR,
        })
        const verification = await recovered.verify(
          APPLICATION_ID,
          BOT_ID,
          action === "send"
            ? attachmentSendRequest(join(root, "missing-private-report.txt"))
            : attachmentReplyRequest(join(root, "missing-private-report.txt")),
        )
        assert.equal(verification.status, "blocked")
        assert.equal(verification.reason, "request-mismatch")
        assert.equal(calls.length, 0)

        const matchedVerification = await recovered.verify(
          APPLICATION_ID,
          BOT_ID,
          request,
        )
        assert.equal(matchedVerification.status, "verified")
        assert.equal(calls.includes("create-attachment-message"), false)
        assert.equal(calls.includes("create-channel"), false)
      } finally {
        await rm(temporary, { force: true, recursive: true })
      }
    })
  }
})

test("direct-message owned-file execution rejects byte drift before durable or Discord writes", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-dm-attachment-drift-"))
  try {
    const root = await realpath(temporary)
    const filePath = join(root, "private-report.txt")
    await writeFile(filePath, "first private bytes")
    const calls: string[] = []
    const store = new FileOperationStore(join(root, "receipts"))
    const service = new DirectMessageService({
      activityStore: new MemoryActivityStore(),
      attachmentMaxBytes: 1_024,
      attachmentRoots: [root],
      client: clientFixture({ calls }),
      operationStore: store,
      planKey: new Uint8Array(32).fill(32),
      policy: policy({ attachments: true, delivery: true }, [root]),
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: PASSTHROUGH_COORDINATOR,
    })
    const request = attachmentSendRequest(filePath)
    const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
    await writeFile(filePath, "other private bytes")
    calls.length = 0

    await assert.rejects(
      service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
      DirectMessagePlanChangedError,
    )
    assert.equal(calls.includes("create-channel"), false)
    assert.equal(calls.includes("create-attachment-message"), false)
    assert.equal(
      await store.getDirectMessage(
        "direct-message-change",
        operationKeyHash(request.operationKey),
      ),
      undefined,
    )
  } finally {
    await rm(temporary, { force: true, recursive: true })
  }
})

test("direct-message reads expose content and bounded counts without profiles or URLs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-read-"))
  try {
    const message = rawMessage({
      attachments: [{
        filename: "private-name.txt",
        id: "900000000000000007",
        size: 12,
        url: "https://cdn.discord.test/private-url",
      }],
      components: [{ private_component: "omitted" }],
      embeds: [{ description: "private embed" }],
      reactions: [],
    })
    const service = new DirectMessageService({
      activityStore: new MemoryActivityStore(),
      client: clientFixture({ message }),
      operationStore: new FileOperationStore(directory),
      policy: policy({ audit: true }),
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: PASSTHROUGH_COORDINATOR,
    })

    const page = await service.list(
      APPLICATION_ID,
      BOT_ID,
      RECIPIENT_ID,
      CHANNEL_ID,
    )

    assert.equal(page.messages[0]?.content, "private secret marker")
    assert.equal(page.messages[0]?.attachmentCount, 1)
    assert.equal(page.messages[0]?.componentCount, 1)
    assert.equal(page.messages[0]?.embedCount, 1)
    const serialized = JSON.stringify(page)
    assert.doesNotMatch(serialized, /private-url|private-name|private embed|Connector Profile/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("direct-message reads normalize static Components V2 and quarantine unsupported rich state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-component-read-"))
  try {
    const supported = new DirectMessageService({
      activityStore: new MemoryActivityStore(),
      client: clientFixture({ message: rawComponentMessage() }),
      operationStore: new FileOperationStore(directory),
      policy: policy({ audit: true }),
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: PASSTHROUGH_COORDINATOR,
    })
    const message = await supported.get(
      APPLICATION_ID,
      BOT_ID,
      RECIPIENT_ID,
      CHANNEL_ID,
      MESSAGE_ID,
    )

    assert.equal(message.presentation, "static-components-v2")
    assert.equal(message.flags, DISCORD_MESSAGE_FLAGS.isComponentsV2)
    assert.equal(message.content, "")
    assert.equal(message.componentCount, 2)
    assert.match(message.componentPreview ?? "", /Text Display/)
    assert.match(message.componentPreview ?? "", new RegExp(COMPONENT_TEXT))
    assert.deepEqual(message.componentLayout, componentBody().components)
    assert.doesNotMatch(JSON.stringify(message.componentLayout), /"id"/)

    for (const unsupportedMessage of [
      rawComponentMessage(COMPONENT_TEXT, {
        components: [{
          custom_id: "private-button-id",
          id: 1,
          label: "Private action",
          style: 1,
          type: 2,
        }],
      }),
      rawComponentMessage(COMPONENT_TEXT, { tts: true }),
    ]) {
      const unsupported = new DirectMessageService({
        activityStore: new MemoryActivityStore(),
        client: clientFixture({ message: unsupportedMessage }),
        operationStore: new FileOperationStore(directory),
        policy: policy({ audit: true }),
        verificationKey: directMessageVerificationKey(TOKEN),
        writeCoordinator: PASSTHROUGH_COORDINATOR,
      })
      const view = await unsupported.get(
        APPLICATION_ID,
        BOT_ID,
        RECIPIENT_ID,
        CHANNEL_ID,
        MESSAGE_ID,
      )
      assert.equal(view.presentation, "unsupported-rich")
      assert.equal(view.componentLayout, null)
      assert.equal(view.componentPreview, null)
      assert.doesNotMatch(JSON.stringify(view), /private-button-id|Private action/)
    }
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("direct-message reads project one bounded attachment without URLs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-attachment-read-"))
  try {
    const message = rawAttachmentMessage({
      content: "Requested private report attached",
      description: "Reviewed private report",
      filename: "private-report.txt",
      sizeBytes: 22,
    })
    const service = new DirectMessageService({
      activityStore: new MemoryActivityStore(),
      client: clientFixture({ message }),
      operationStore: new FileOperationStore(directory),
      policy: policy({ audit: true }),
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: PASSTHROUGH_COORDINATOR,
    })

    const view = await service.get(
      APPLICATION_ID,
      BOT_ID,
      RECIPIENT_ID,
      CHANNEL_ID,
      MESSAGE_ID,
    )

    assert.equal(view.presentation, "single-attachment")
    assert.deepEqual(view.attachment, {
      description: "Reviewed private report",
      filename: "private-report.txt",
      id: "900000000000000008",
      sizeBytes: 22,
    })
    assert.doesNotMatch(
      JSON.stringify(view),
      /private-file|private-proxy|application\/octet-stream|content_type|proxy_url/,
    )

    for (const unsupportedMessage of [
      rawAttachmentMessage({}, { pinned: true }),
      rawAttachmentMessage({}, { mention_everyone: true }),
      rawAttachmentMessage({}, {
        attachments: [{
          filename: "../unsafe.txt",
          id: "900000000000000008",
          size: 22,
          url: "https://cdn.discord.test/unsafe",
        }],
      }),
    ]) {
      const unsupported = new DirectMessageService({
        activityStore: new MemoryActivityStore(),
        client: clientFixture({ message: unsupportedMessage }),
        operationStore: new FileOperationStore(directory),
        policy: policy({ audit: true }),
        verificationKey: directMessageVerificationKey(TOKEN),
        writeCoordinator: PASSTHROUGH_COORDINATOR,
      })
      const unsupportedView = await unsupported.get(
        APPLICATION_ID,
        BOT_ID,
        RECIPIENT_ID,
        CHANNEL_ID,
        MESSAGE_ID,
      )
      assert.equal(unsupportedView.presentation, "unsupported-rich")
      assert.equal(unsupportedView.attachment, null)
      assert.doesNotMatch(JSON.stringify(unsupportedView), /unsafe/)
    }
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("direct-message reply, edit, and deletion coordinate exact targets and verify readback", async (t) => {
  const cases: Array<{
    action: "delete" | "edit" | "reply"
    request: DirectMessageChangeRequest
    resultMessageId: string
  }> = [
    { action: "reply", request: replyRequest(), resultMessageId: RESULT_MESSAGE_ID },
    { action: "edit", request: editRequest(), resultMessageId: MESSAGE_ID },
    { action: "delete", request: deleteRequest(), resultMessageId: MESSAGE_ID },
  ]

  for (const entry of cases) {
    await t.test(entry.action, async () => {
      const directory = await mkdtemp(join(tmpdir(), `discord-mcp-dm-${entry.action}-`))
      try {
        const calls: string[] = []
        let capturedIntent: WriteCoordinationIntent | undefined
        let current = rawMessage()
        let exists = true
        const reply = rawMessage({
          content: "private reply marker",
          id: RESULT_MESSAGE_ID,
          message_reference: {
            channel_id: CHANNEL_ID,
            message_id: MESSAGE_ID,
            type: DISCORD_MESSAGE_REFERENCE_TYPES.default,
          },
          type: DISCORD_MESSAGE_TYPES.reply,
        })
        const base = clientFixture({ calls })
        const client: DirectMessageServiceClient = {
          ...base,
          async createDirectMessage(_channelId, input) {
            calls.push("create-message")
            assert.equal(entry.action, "reply")
            assert.equal(input.content, "private reply marker")
            assert.equal(input.replyToMessageId, MESSAGE_ID)
            return reply
          },
          async deleteDirectMessage() {
            calls.push("delete-message")
            assert.equal(entry.action, "delete")
            exists = false
          },
          async editDirectMessage(_channelId, _messageId, content) {
            calls.push("edit-message")
            assert.equal(entry.action, "edit")
            current = rawMessage({ content })
            return current
          },
          async getDirectMessage(_channelId, messageId) {
            calls.push("get-message")
            if (!exists) throw apiError(404)
            if (entry.action === "reply" && messageId === RESULT_MESSAGE_ID) {
              return reply
            }
            return current
          },
        }
        const activities = new MemoryActivityStore()
        const coordinator: WriteCoordinator = {
          async run<T>(intent: WriteCoordinationIntent, operation: () => Promise<T>) {
            capturedIntent = intent
            return operation()
          },
        }
        const service = new DirectMessageService({
          activityStore: activities,
          client,
          clock: () => new Date(TIMESTAMP),
          operationStore: new FileOperationStore(directory),
          planKey: new Uint8Array(32).fill(11),
          policy: policy({
            deletion: entry.action === "delete",
            delivery: entry.action === "reply",
            editing: entry.action === "edit",
          }),
          randomId: () => `direct_message_activity_${entry.action}`,
          verificationKey: directMessageVerificationKey(TOKEN),
          writeCoordinator: coordinator,
        })

        const plan = await service.plan(APPLICATION_ID, BOT_ID, entry.request)
        const result = await service.execute(
          APPLICATION_ID,
          BOT_ID,
          entry.request,
          plan.digest,
        )

        assert.equal(result.status, "completed")
        assert.equal(result.messageId, entry.resultMessageId)
        assert.deepEqual(capturedIntent, {
          kind: "direct-message-change",
          operationKeyHash: operationKeyHash(entry.request.operationKey),
          planDigest: plan.digest,
          targets: [
            { id: RECIPIENT_ID, kind: "user" },
            { id: CHANNEL_ID, kind: "channel" },
            { id: MESSAGE_ID, kind: "message" },
          ],
        })
        assert.deepEqual(
          activities.entries.map((activity) => (
            activity.kind === "direct-message-change" ? activity.stage : null
          )),
          ["reserved", "message-dispatched", "terminal"],
        )
        const verification = await service.verify(
          APPLICATION_ID,
          BOT_ID,
          entry.request,
        )
        assert.equal(verification.status, "verified")
        assert.equal(verification.readbackMatched, true)
      } finally {
        await rm(directory, { force: true, recursive: true })
      }
    })
  }
})

test("direct-message Components V2 reply and same-format edit verify exact readback", async (t) => {
  for (const action of ["reply", "edit"] as const) {
    await t.test(action, async () => {
      const directory = await mkdtemp(join(tmpdir(), `discord-mcp-dm-components-${action}-`))
      try {
        const calls: string[] = []
        const target = action === "reply"
          ? rawMessage({
              author: { id: RECIPIENT_ID, username: "Private Recipient" },
              content: "private recipient prompt",
            })
          : rawComponentMessage("private original component marker")
        const request = action === "reply"
          ? componentReplyRequest()
          : componentEditRequest()
        let current = target
        const response = rawComponentMessage(
          action === "reply"
            ? COMPONENT_TEXT
            : "private replacement component marker",
          action === "reply"
            ? {
                id: RESULT_MESSAGE_ID,
                message_reference: {
                  channel_id: CHANNEL_ID,
                  message_id: MESSAGE_ID,
                  type: DISCORD_MESSAGE_REFERENCE_TYPES.default,
                },
                type: DISCORD_MESSAGE_TYPES.reply,
              }
            : {},
        )
        const base = clientFixture({ calls, message: target })
        const client: DirectMessageServiceClient = {
          ...base,
          async createDirectComponentMessage(_channelId, input) {
            calls.push("create-component-message")
            assert.equal(action, "reply")
            assert.equal(input.replyToMessageId, MESSAGE_ID)
            current = response
            return response
          },
          async createDirectMessage() {
            assert.fail("Static private replies must not use the text mutation")
          },
          async editDirectComponentMessage(_channelId, _messageId, input) {
            calls.push("edit-component-message")
            assert.equal(action, "edit")
            assert.equal(input.flags, DISCORD_MESSAGE_FLAGS.isComponentsV2)
            current = response
            return response
          },
          async editDirectMessage() {
            assert.fail("Static private edits must not use the text mutation")
          },
          async getDirectMessage(_channelId, messageId) {
            calls.push("get-message")
            return action === "reply" && messageId === MESSAGE_ID
              ? target
              : current
          },
        }
        const service = new DirectMessageService({
          activityStore: new MemoryActivityStore(),
          client,
          clock: () => new Date(TIMESTAMP),
          operationStore: new FileOperationStore(directory),
          planKey: new Uint8Array(32).fill(action === "reply" ? 24 : 25),
          policy: policy({ delivery: true, editing: true }),
          randomId: () => `direct_message_activity_components_${action}`,
          verificationKey: directMessageVerificationKey(TOKEN),
          writeCoordinator: PASSTHROUGH_COORDINATOR,
        })
        const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
        const result = await service.execute(
          APPLICATION_ID,
          BOT_ID,
          request,
          plan.digest,
        )

        assert.equal(result.status, "completed")
        assert.equal(
          result.messageId,
          action === "reply" ? RESULT_MESSAGE_ID : MESSAGE_ID,
        )
        assert.equal(
          calls.filter((call) => call === (action === "reply"
            ? "create-component-message"
            : "edit-component-message")).length,
          1,
        )
        const verified = await service.verify(
          APPLICATION_ID,
          BOT_ID,
          request,
        )
        assert.equal(verified.status, "verified")
      } finally {
        await rm(directory, { force: true, recursive: true })
      }
    })
  }
})

test("direct-message identical edit is a record-free no-op", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-noop-"))
  try {
    let coordinationCalls = 0
    const activities = new MemoryActivityStore()
    const request = editRequest("private secret marker")
    const service = new DirectMessageService({
      activityStore: activities,
      client: clientFixture(),
      operationStore: new FileOperationStore(directory),
      planKey: new Uint8Array(32).fill(12),
      policy: policy({ editing: true }),
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: {
        async run<T>(_intent: WriteCoordinationIntent, operation: () => Promise<T>) {
          coordinationCalls += 1
          return operation()
        },
      },
    })

    const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
    assert.equal(plan.effect, "none")
    assert.equal(plan.status, "already-current")
    const result = await service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    )
    assert.equal(result.status, "already-current")
    assert.equal(result.activityId, null)
    assert.equal(coordinationCalls, 0)
    assert.deepEqual(activities.entries, [])
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("direct-message Components V2 edits are no-op exact and reject format conversion", async () => {
  const noOpDirectory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-component-noop-"))
  try {
    const calls: string[] = []
    const request = componentEditRequest(COMPONENT_TEXT)
    const service = new DirectMessageService({
      activityStore: new MemoryActivityStore(),
      client: clientFixture({ calls, message: rawComponentMessage() }),
      operationStore: new FileOperationStore(noOpDirectory),
      policy: policy({ editing: true }),
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: PASSTHROUGH_COORDINATOR,
    })
    const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
    assert.equal(plan.effect, "none")
    assert.equal(plan.status, "already-current")
    const result = await service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    )
    assert.equal(result.status, "already-current")
    assert.equal(calls.includes("edit-component-message"), false)
  } finally {
    await rm(noOpDirectory, { force: true, recursive: true })
  }

  for (const entry of [
    {
      message: rawComponentMessage(),
      request: editRequest(),
    },
    {
      message: rawMessage(),
      request: componentEditRequest(),
    },
    {
      message: rawComponentMessage(COMPONENT_TEXT, { pinned: true }),
      request: componentEditRequest(),
    },
  ]) {
    const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-component-format-"))
    try {
      const service = new DirectMessageService({
        activityStore: new MemoryActivityStore(),
        client: clientFixture({ message: entry.message }),
        operationStore: new FileOperationStore(directory),
        policy: policy({ editing: true }),
        verificationKey: directMessageVerificationKey(TOKEN),
        writeCoordinator: PASSTHROUGH_COORDINATOR,
      })
      await assert.rejects(
        () => service.plan(APPLICATION_ID, BOT_ID, entry.request),
        /same-format connector-authored message/,
      )
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }
})

test("direct-message execution refuses changed exact message evidence before coordination", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-stale-plan-"))
  try {
    const calls: string[] = []
    let current = rawMessage()
    let coordinationCalls = 0
    const base = clientFixture({ calls })
    const service = new DirectMessageService({
      activityStore: new MemoryActivityStore(),
      client: {
        ...base,
        async getDirectMessage() {
          calls.push("get-message")
          return current
        },
      },
      operationStore: new FileOperationStore(directory),
      planKey: new Uint8Array(32).fill(19),
      policy: policy({ editing: true }),
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: {
        async run<T>(_intent: WriteCoordinationIntent, operation: () => Promise<T>) {
          coordinationCalls += 1
          return operation()
        },
      },
    })
    const request = editRequest()
    const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
    current = rawMessage({ content: "concurrent private change" })
    await assert.rejects(
      () => service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
      DirectMessagePlanChangedError,
    )
    assert.equal(coordinationCalls, 0)
    assert.equal(calls.includes("edit-message"), false)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("direct-message send execution checkpoints exact identities and recovers without redispatch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-execute-"))
  try {
    const calls: string[] = []
    let capturedIntent: WriteCoordinationIntent | undefined
    const activities = new MemoryActivityStore()
    const store = new FileOperationStore(directory)
    const service = new DirectMessageService({
      activityStore: activities,
      client: clientFixture({ calls }),
      clock: () => new Date(TIMESTAMP),
      operationStore: store,
      planKey: new Uint8Array(32).fill(9),
      policy: policy({ delivery: true }),
      randomId: () => "direct_message_activity_1",
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: {
        async run<T>(intent: WriteCoordinationIntent, operation: () => Promise<T>) {
          capturedIntent = intent
          return operation()
        },
      },
    })
    const request = sendRequest()
    const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
    const result = await service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    )

    assert.equal(result.status, "completed")
    assert.equal(result.channelId, CHANNEL_ID)
    assert.equal(result.messageId, MESSAGE_ID)
    assert.equal(calls.filter((call) => call === "create-channel").length, 1)
    assert.equal(calls.filter((call) => call === "create-message").length, 1)
    assert.deepEqual(capturedIntent, {
      kind: "direct-message-change",
      operationKeyHash: operationKeyHash(request.operationKey),
      planDigest: plan.digest,
      targets: [{ id: RECIPIENT_ID, kind: "user" }],
    })
    assert.deepEqual(
      activities.entries.map((entry) => (
        entry.kind === "direct-message-change" ? entry.stage : null
      )),
      ["reserved", "channel-ready", "message-dispatched", "terminal"],
    )

    const verified = await service.verify(
      APPLICATION_ID,
      BOT_ID,
      request,
    )
    assert.equal(verified.status, "verified")
    assert.equal(verified.requestMatched, true)
    assert.equal(verified.readbackMatched, true)

    const recovered = await service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    )
    assert.equal(recovered.recovered, true)
    assert.equal(calls.filter((call) => call === "create-channel").length, 1)
    assert.equal(calls.filter((call) => call === "create-message").length, 1)

    const beforeDigestMismatch = calls.length
    await assert.rejects(
      () => service.execute(
        APPLICATION_ID,
        BOT_ID,
        request,
        `hmac-sha256:${"b".repeat(64)}`,
      ),
      DirectMessageOperationConflictError,
    )
    assert.equal(calls.length, beforeDigestMismatch)

    const beforeMismatch = calls.length
    await assert.rejects(
      () => service.execute(
        APPLICATION_ID,
        BOT_ID,
        sendRequest("different private content"),
        plan.digest,
      ),
      DirectMessageOperationConflictError,
    )
    assert.equal(calls.length, beforeMismatch)

    const receiptFiles = (await readdir(directory, { recursive: true }))
      .filter((entry) => entry.endsWith(".json"))
    const receiptBytes = (await Promise.all(receiptFiles.map((entry) => (
      readFile(join(directory, entry), "utf8")
    )))).join("\n")
    assert.doesNotMatch(
      receiptBytes,
      /private secret marker|operator private reason|Private Application|Connector Profile/,
    )
    assert.doesNotMatch(
      JSON.stringify(activities.entries),
      /private secret marker|operator private reason|Private Application|Connector Profile/,
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("direct-message Components V2 send persists only its format and recovers after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-component-send-"))
  try {
    const calls: string[] = []
    const activities = new MemoryActivityStore()
    const store = new FileOperationStore(directory)
    const base = clientFixture({ calls, message: rawComponentMessage() })
    const client: DirectMessageServiceClient = {
      ...base,
      async createDirectComponentMessage(channelId, input) {
        calls.push("create-component-message")
        assert.equal(channelId, CHANNEL_ID)
        assert.equal(input.replyToMessageId, undefined)
        assert.deepEqual(input.components, [{
          accent_color: 0x12_34_56,
          components: [
            { content: COMPONENT_TEXT, type: 10 },
            { divider: true, spacing: 2, type: 14 },
          ],
          spoiler: false,
          type: 17,
        }, {
          content: "private component footer",
          type: 10,
        }])
        return rawComponentMessage(COMPONENT_TEXT, { nonce: input.nonce })
      },
      async createDirectMessage() {
        assert.fail("Components V2 must not use the plain-text mutation")
      },
    }
    const planKey = new Uint8Array(32).fill(23)
    const options = {
      activityStore: activities,
      client,
      clock: () => new Date(TIMESTAMP),
      operationStore: store,
      planKey,
      policy: policy({ delivery: true }),
      randomId: () => "direct_message_activity_components",
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: PASSTHROUGH_COORDINATOR,
    }
    const service = new DirectMessageService(options)
    const request = componentSendRequest()
    const plan = await service.plan(APPLICATION_ID, BOT_ID, request)

    assert.equal(plan.desired.message?.kind, "components-v2")
    assert.match(plan.desired.preview ?? "", new RegExp(COMPONENT_TEXT))
    assert.match(plan.warnings.join("\n"), /irreversible/)
    const result = await service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    )
    assert.equal(result.status, "completed")
    assert.equal(calls.filter((call) => call === "create-component-message").length, 1)

    const receipt = await store.getDirectMessage(
      "direct-message-change",
      operationKeyHash(request.operationKey),
    )
    assert.equal(receipt?.messageFormat, "components-v2")
    assert.deepEqual(
      activities.entries
        .filter((entry) => entry.kind === "direct-message-change")
        .map((entry) => entry.messageFormat),
      ["components-v2", "components-v2", "components-v2", "components-v2"],
    )

    const restarted = new DirectMessageService({
      ...options,
      activityStore: new MemoryActivityStore(),
    })
    const recovered = await restarted.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    )
    assert.equal(recovered.recovered, true)
    assert.equal(calls.filter((call) => call === "create-component-message").length, 1)

    const receiptFiles = (await readdir(directory, { recursive: true }))
      .filter((entry) => entry.endsWith(".json"))
    const receiptBytes = (await Promise.all(receiptFiles.map((entry) => (
      readFile(join(directory, entry), "utf8")
    )))).join("\n")
    assert.doesNotMatch(
      receiptBytes,
      /private component marker|private component footer|static private layout/,
    )
    assert.doesNotMatch(
      JSON.stringify(activities.entries),
      /private component marker|private component footer|static private layout/,
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("direct-message verification recovers an uncertain dispatch without scanning or retrying", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-verify-"))
  try {
    const calls: string[] = []
    let failReadback = true
    const base = clientFixture({ calls })
    const client: DirectMessageServiceClient = {
      ...base,
      async getDirectMessage() {
        calls.push("get-message")
        if (failReadback) {
          failReadback = false
          throw apiError(500)
        }
        return rawMessage()
      },
    }
    const service = new DirectMessageService({
      activityStore: new MemoryActivityStore(),
      client,
      clock: () => new Date(TIMESTAMP),
      operationStore: new FileOperationStore(directory),
      planKey: new Uint8Array(32).fill(13),
      policy: policy({ delivery: true }),
      randomId: () => "direct_message_activity_uncertain",
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: PASSTHROUGH_COORDINATOR,
    })
    const request = sendRequest()
    const absentCalls = calls.length
    const absent = await service.verify(
      APPLICATION_ID,
      BOT_ID,
      sendRequest("different operation with no receipt"),
    )
    assert.equal(absent.status, "not-found")
    assert.equal(absent.reason, "operation-not-found")
    assert.equal(calls.length, absentCalls)

    const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
    await assert.rejects(
      () => service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
      (error: unknown) => (
        error instanceof DirectMessageExecutionError
        && (error.result as Record<string, unknown>).status === "uncertain"
      ),
    )
    assert.equal(calls.filter((call) => call === "create-message").length, 1)

    const recovered = await service.verify(
      APPLICATION_ID,
      BOT_ID,
      request,
    )
    assert.equal(recovered.status, "verified")
    assert.equal(recovered.receiptStatus, "uncertain")
    assert.equal(recovered.requestMatched, true)
    assert.equal(recovered.readbackMatched, true)

    const beforeMismatch = calls.length
    const mismatch = await service.verify(
      APPLICATION_ID,
      BOT_ID,
      sendRequest("changed caller-retained content"),
    )
    assert.equal(mismatch.status, "blocked")
    assert.equal(mismatch.reason, "request-mismatch")
    assert.equal(calls.length, beforeMismatch)

    await assert.rejects(
      () => service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
      DirectMessageOperationConflictError,
    )
    assert.equal(calls.filter((call) => call === "create-message").length, 1)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("direct-message verification blocks pending and failed receipts before Discord access", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-verify-state-"))
  try {
    const calls: string[] = []
    const store = new FileOperationStore(directory)
    const request = sendRequest()
    const normalized = normalizeDirectMessageChangeRequest(request)
    const service = new DirectMessageService({
      activityStore: new MemoryActivityStore(),
      client: clientFixture({ calls }),
      clock: () => new Date(TIMESTAMP),
      operationStore: store,
      planKey: new Uint8Array(32).fill(14),
      policy: policy({ delivery: true }),
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: PASSTHROUGH_COORDINATOR,
    })
    const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
    const receipt: DirectMessageOperationReceipt = {
      action: "send",
      activityId: "direct_message_activity_pending",
      attachmentSizeBytes: null,
      channelId: null,
      error: null,
      kind: "direct-message-change",
      messageFormat: "text",
      messageId: null,
      operationKeyHash: normalized.operationKeyHash,
      planDigest: plan.digest,
      recipientId: RECIPIENT_ID,
      replyToMessageId: null,
      requestDigest: directMessageRequestDigest(
        directMessageVerificationKey(TOKEN),
        APPLICATION_ID,
        BOT_ID,
        normalized,
      ),
      schemaVersion: 2,
      stage: "reserved",
      status: "pending",
      timestamp: TIMESTAMP,
      verification: null,
    }
    assert.equal((await store.reserveDirectMessage(receipt)).created, true)
    const beforeVerify = calls.length
    const pending = await service.verify(APPLICATION_ID, BOT_ID, request)
    assert.equal(pending.status, "blocked")
    assert.equal(pending.reason, "operation-pending")
    assert.equal(calls.length, beforeVerify)

    await store.finishDirectMessage({
      ...receipt,
      error: "DiscordApiError.403.unknown",
      stage: "terminal",
      status: "failed",
    })
    const failed = await service.verify(APPLICATION_ID, BOT_ID, request)
    assert.equal(failed.status, "blocked")
    assert.equal(failed.reason, "operation-failed")
    assert.equal(calls.length, beforeVerify)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("direct-message execution quarantines a creation response with parsed mentions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-mentions-"))
  try {
    const calls: string[] = []
    const activities = new MemoryActivityStore()
    const service = new DirectMessageService({
      activityStore: activities,
      client: clientFixture({
        calls,
        message: rawMessage({
          mentions: [{
            id: RECIPIENT_ID,
            username: "Private Recipient",
          }],
        }),
      }),
      clock: () => new Date(TIMESTAMP),
      operationStore: new FileOperationStore(directory),
      planKey: new Uint8Array(32).fill(8),
      policy: policy({ delivery: true }),
      randomId: () => "direct_message_activity_mentions",
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: PASSTHROUGH_COORDINATOR,
    })
    const request = sendRequest()
    const plan = await service.plan(APPLICATION_ID, BOT_ID, request)

    await assert.rejects(
      () => service.execute(
        APPLICATION_ID,
        BOT_ID,
        request,
        plan.digest,
      ),
      (error: unknown) => (
        error instanceof DirectMessageExecutionError
        && (error.result as Record<string, unknown>).status === "uncertain"
      ),
    )

    assert.equal(calls.filter((call) => call === "create-message").length, 1)
    assert.equal(
      activities.entries.at(-1)?.kind,
      "direct-message-change",
    )
    assert.equal(
      activities.entries.at(-1)?.status,
      "uncertain",
    )
    assert.doesNotMatch(
      JSON.stringify(activities.entries),
      /Private Recipient|private secret marker|operator private reason/,
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("direct-message execution distinguishes deterministic refusal from ambiguous dispatch", async (t) => {
  for (const expected of [
    { receiptReason: "operation-failed", status: 403, terminal: "failed" },
    { receiptReason: "operation-uncertain", status: 429, terminal: "uncertain" },
    { receiptReason: "operation-uncertain", status: 500, terminal: "uncertain" },
  ] as const) {
    await t.test(String(expected.status), async () => {
      const directory = await mkdtemp(join(tmpdir(), `discord-mcp-dm-error-${expected.status}-`))
      try {
        const calls: string[] = []
        const base = clientFixture({ calls })
        const client: DirectMessageServiceClient = {
          ...base,
          async createDirectMessageChannel() {
            calls.push("create-channel")
            throw apiError(expected.status)
          },
        }
        const activities = new MemoryActivityStore()
        const service = new DirectMessageService({
          activityStore: activities,
          client,
          clock: () => new Date(TIMESTAMP),
          operationStore: new FileOperationStore(directory),
          planKey: new Uint8Array(32).fill(expected.status % 255),
          policy: policy({ delivery: true }),
          randomId: () => `direct_message_activity_error_${expected.status}`,
          verificationKey: directMessageVerificationKey(TOKEN),
          writeCoordinator: PASSTHROUGH_COORDINATOR,
        })
        const request = {
          ...sendRequest(),
          operationKey: `${OPERATION_KEY}-${expected.status}`,
        } satisfies DirectMessageChangeRequest
        const plan = await service.plan(APPLICATION_ID, BOT_ID, request)

        await assert.rejects(
          () => service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
          (error: unknown) => (
            error instanceof DirectMessageExecutionError
            && (error.result as Record<string, unknown>).status === expected.terminal
          ),
        )
        assert.equal(calls.filter((call) => call === "create-channel").length, 1)
        assert.equal(calls.includes("create-message"), false)
        assert.equal(activities.entries.at(-1)?.status, expected.terminal)
        assert.doesNotMatch(
          JSON.stringify(activities.entries),
          /private Discord transport detail|users\/@me\/channels/,
        )

        const beforeVerify = calls.length
        const verification = await service.verify(
          APPLICATION_ID,
          BOT_ID,
          request,
        )
        assert.equal(verification.status, "blocked")
        assert.equal(verification.reason, expected.receiptReason)
        assert.equal(calls.length, beforeVerify)
      } finally {
        await rm(directory, { force: true, recursive: true })
      }
    })
  }
})

test("direct-message execution keeps a post-mutation 403 readback uncertain", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-readback-403-"))
  try {
    const calls: string[] = []
    const base = clientFixture({ calls })
    const client: DirectMessageServiceClient = {
      ...base,
      async getDirectMessage() {
        calls.push("get-message")
        throw apiError(403)
      },
    }
    const activities = new MemoryActivityStore()
    const operationStore = new FileOperationStore(directory)
    const service = new DirectMessageService({
      activityStore: activities,
      client,
      clock: () => new Date(TIMESTAMP),
      operationStore,
      planKey: new Uint8Array(32).fill(17),
      policy: policy({ delivery: true }),
      randomId: () => "direct_message_activity_readback_403",
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: PASSTHROUGH_COORDINATOR,
    })
    const request = {
      ...sendRequest(),
      operationKey: `${OPERATION_KEY}-readback-403`,
    } satisfies DirectMessageChangeRequest
    const plan = await service.plan(APPLICATION_ID, BOT_ID, request)

    await assert.rejects(
      () => service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
      (error: unknown) => (
        error instanceof DirectMessageExecutionError
        && (error.result as Record<string, unknown>).status === "uncertain"
      ),
    )

    assert.equal(calls.filter((call) => call === "create-message").length, 1)
    assert.equal(activities.entries.at(-1)?.status, "uncertain")
    const receipt = await operationStore.getDirectMessage(
      "direct-message-change",
      operationKeyHash(request.operationKey),
    )
    assert.equal(receipt?.status, "uncertain")
    assert.equal(receipt?.channelId, CHANNEL_ID)
    assert.equal(receipt?.messageId, MESSAGE_ID)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("direct-message pending activity failure blocks Discord contact and settles failed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-pending-audit-"))
  try {
    const calls: string[] = []
    const service = new DirectMessageService({
      activityStore: new SelectiveActivityStore((_entry, count) => count === 1),
      client: clientFixture({ calls }),
      clock: () => new Date(TIMESTAMP),
      operationStore: new FileOperationStore(directory),
      planKey: new Uint8Array(32).fill(15),
      policy: policy({ delivery: true }),
      randomId: () => "direct_message_activity_pending_audit_failure",
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: PASSTHROUGH_COORDINATOR,
    })
    const request = sendRequest()
    const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
    await assert.rejects(
      () => service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
      (error: unknown) => (
        error instanceof DirectMessageExecutionError
        && (error.result as Record<string, unknown>).status === "blocked-audit-failed"
      ),
    )
    assert.equal(calls.includes("create-channel"), false)
    assert.equal(calls.includes("create-message"), false)
    const beforeVerify = calls.length
    const verification = await service.verify(APPLICATION_ID, BOT_ID, request)
    assert.equal(verification.reason, "operation-failed")
    assert.equal(calls.length, beforeVerify)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("direct-message completion reports operation and activity finalization failures safely", async (t) => {
  await t.test("operation receipt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-receipt-failure-"))
    try {
      const calls: string[] = []
      const activities = new MemoryActivityStore()
      const baseStore = new FileOperationStore(directory)
      const service = new DirectMessageService({
        activityStore: activities,
        client: clientFixture({ calls }),
        clock: () => new Date(TIMESTAMP),
        operationStore: wrappedOperationStore(baseStore, {
          async finishDirectMessage(receipt) {
            if (receipt.status === "completed") {
              throw new Error("private operation store detail")
            }
            await baseStore.finishDirectMessage(receipt)
          },
        }),
        planKey: new Uint8Array(32).fill(16),
        policy: policy({ delivery: true }),
        randomId: () => "direct_message_activity_receipt_failure",
        verificationKey: directMessageVerificationKey(TOKEN),
        writeCoordinator: PASSTHROUGH_COORDINATOR,
      })
      const request = sendRequest()
      const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
      await assert.rejects(
        () => service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
        (error: unknown) => (
          error instanceof DirectMessageExecutionError
          && (error.result as Record<string, unknown>).status
            === "completed-operation-record-failed"
        ),
      )
      assert.equal(calls.filter((call) => call === "create-message").length, 1)
      assert.equal(activities.entries.at(-1)?.status, "uncertain")
      assert.doesNotMatch(
        JSON.stringify(activities.entries),
        /private operation store detail|private secret marker|operator private reason/,
      )
      const verification = await service.verify(APPLICATION_ID, BOT_ID, request)
      assert.equal(verification.reason, "operation-pending")
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  await t.test("terminal activity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-terminal-audit-failure-"))
    try {
      const calls: string[] = []
      const activities = new SelectiveActivityStore((entry) => (
        entry.kind === "direct-message-change" && entry.status === "completed"
      ))
      const service = new DirectMessageService({
        activityStore: activities,
        client: clientFixture({ calls }),
        clock: () => new Date(TIMESTAMP),
        operationStore: new FileOperationStore(directory),
        planKey: new Uint8Array(32).fill(17),
        policy: policy({ delivery: true }),
        randomId: () => "direct_message_activity_terminal_failure",
        verificationKey: directMessageVerificationKey(TOKEN),
        writeCoordinator: PASSTHROUGH_COORDINATOR,
      })
      const request = sendRequest()
      const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
      await assert.rejects(
        () => service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
        (error: unknown) => (
          error instanceof DirectMessageExecutionError
          && (error.result as Record<string, unknown>).status
            === "completed-activity-record-failed"
        ),
      )
      assert.equal(calls.filter((call) => call === "create-message").length, 1)
      const recovered = await service.execute(
        APPLICATION_ID,
        BOT_ID,
        request,
        plan.digest,
      )
      assert.equal(recovered.recovered, true)
      assert.equal(calls.filter((call) => call === "create-message").length, 1)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})

test("direct-message limiter rejects a second same-recipient operation before durable or Discord writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-rate-limit-"))
  try {
    const calls: string[] = []
    const service = new DirectMessageService({
      activityStore: new MemoryActivityStore(),
      client: clientFixture({ calls }),
      clock: () => new Date(TIMESTAMP),
      limiter: new InteractionLimiter({
        clock: () => 1_000,
        maxWritesPerMinute: 5,
        minWriteIntervalMs: 5_000,
      }),
      operationStore: new FileOperationStore(directory),
      planKey: new Uint8Array(32).fill(18),
      policy: policy({ delivery: true }),
      randomId: () => "direct_message_activity_rate_limit",
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: PASSTHROUGH_COORDINATOR,
    })
    const first = sendRequest()
    const firstPlan = await service.plan(APPLICATION_ID, BOT_ID, first)
    await service.execute(APPLICATION_ID, BOT_ID, first, firstPlan.digest)
    const second = {
      ...sendRequest("second private message"),
      operationKey: `${OPERATION_KEY}-second`,
    } satisfies DirectMessageChangeRequest
    const secondPlan = await service.plan(APPLICATION_ID, BOT_ID, second)
    const beforeWrites = calls.filter((call) => (
      call === "create-channel" || call === "create-message"
    )).length
    await assert.rejects(
      () => service.execute(
        APPLICATION_ID,
        BOT_ID,
        second,
        secondPlan.digest,
      ),
      (error: unknown) => (
        error instanceof InteractionRateLimitError
        && error.retryAfterMs === 5_000
      ),
    )
    assert.equal(
      calls.filter((call) => (
        call === "create-channel" || call === "create-message"
      )).length,
      beforeWrites,
    )
    const verification = await service.verify(APPLICATION_ID, BOT_ID, second)
    assert.equal(verification.status, "not-found")
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("direct-message edits reject legacy sticker and reaction state", async () => {
  for (const message of [
    rawMessage({
      sticker_items: [],
      stickers: [{
        format_type: 1,
        id: "900000000000000007",
        name: "Private Sticker",
      }],
    }),
    rawMessage({
      reactions: [{
        burst_colors: [],
        count: 1,
        count_details: { burst: 0, normal: 1 },
        emoji: { id: null, name: "x" },
        me: false,
        me_burst: false,
      }],
    }),
  ]) {
    const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-plain-edit-"))
    try {
      const service = new DirectMessageService({
        activityStore: new MemoryActivityStore(),
        client: clientFixture({ message }),
        operationStore: new FileOperationStore(directory),
        policy: policy({ editing: true }),
        verificationKey: directMessageVerificationKey(TOKEN),
        writeCoordinator: PASSTHROUGH_COORDINATOR,
      })

      await assert.rejects(
        () => service.plan(APPLICATION_ID, BOT_ID, {
          action: "edit",
          channelId: CHANNEL_ID,
          message: { content: "replacement", kind: "text" },
          messageId: MESSAGE_ID,
          operationKey: OPERATION_KEY,
          recipientId: RECIPIENT_ID,
          reviewReason: "review exact plain edit",
        }),
        DirectMessageEvidenceError,
      )
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }
})

test("direct-message deletion accepts exact static Components V2 and rejects richer state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-component-delete-"))
  try {
    const calls: string[] = []
    let exists = true
    const message = rawComponentMessage()
    const base = clientFixture({ calls, message })
    const store = new FileOperationStore(directory)
    const client: DirectMessageServiceClient = {
      ...base,
      async deleteDirectMessage() {
        calls.push("delete-message")
        exists = false
      },
      async getDirectMessage() {
        calls.push("get-message")
        if (!exists) throw apiError(404)
        return message
      },
    }
    const service = new DirectMessageService({
      activityStore: new MemoryActivityStore(),
      client,
      clock: () => new Date(TIMESTAMP),
      operationStore: store,
      planKey: new Uint8Array(32).fill(26),
      policy: policy({ deletion: true }),
      randomId: () => "direct_message_activity_component_delete",
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: PASSTHROUGH_COORDINATOR,
    })
    const request = deleteRequest()
    const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
    assert.equal(plan.current?.presentation, "static-components-v2")
    const result = await service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    )
    assert.equal(result.status, "completed")
    assert.equal(calls.filter((call) => call === "delete-message").length, 1)
    const receipt = await store.getDirectMessage(
      "direct-message-change",
      operationKeyHash(request.operationKey),
    )
    assert.equal(receipt?.messageFormat, null)
    const verified = await service.verify(APPLICATION_ID, BOT_ID, request)
    assert.equal(verified.status, "verified")
  } finally {
    await rm(directory, { force: true, recursive: true })
  }

  for (const message of [
    rawComponentMessage(COMPONENT_TEXT, { pinned: true }),
    rawComponentMessage(COMPONENT_TEXT, {
      reactions: [{
        burst_colors: [],
        count: 1,
        count_details: { burst: 0, normal: 1 },
        emoji: { id: null, name: "x" },
        me: false,
        me_burst: false,
      }],
    }),
    rawComponentMessage(COMPONENT_TEXT, {
      components: [{ custom_id: "unsafe", id: 1, type: 2 }],
    }),
  ]) {
    const unsafeDirectory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-component-delete-unsafe-"))
    try {
      const service = new DirectMessageService({
        activityStore: new MemoryActivityStore(),
        client: clientFixture({ message }),
        operationStore: new FileOperationStore(unsafeDirectory),
        policy: policy({ deletion: true }),
        verificationKey: directMessageVerificationKey(TOKEN),
        writeCoordinator: PASSTHROUGH_COORDINATOR,
      })
      await assert.rejects(
        () => service.plan(APPLICATION_ID, BOT_ID, deleteRequest()),
        /exact supported connector-authored message/,
      )
    } finally {
      await rm(unsafeDirectory, { force: true, recursive: true })
    }
  }
})

test("direct-message deletion accepts one exact URL-free attachment projection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-attachment-delete-"))
  try {
    const calls: string[] = []
    let exists = true
    const message = rawAttachmentMessage({
      description: "Reviewed private report",
      filename: "private-report.txt",
      sizeBytes: 22,
    })
    const client: DirectMessageServiceClient = {
      ...clientFixture({ calls, message }),
      async deleteDirectMessage() {
        calls.push("delete-message")
        exists = false
      },
      async getDirectMessage() {
        calls.push("get-message")
        if (!exists) throw apiError(404)
        return message
      },
    }
    const service = new DirectMessageService({
      activityStore: new MemoryActivityStore(),
      client,
      clock: () => new Date(TIMESTAMP),
      operationStore: new FileOperationStore(directory),
      planKey: new Uint8Array(32).fill(33),
      policy: policy({ deletion: true }),
      randomId: () => "direct_message_activity_attachment_delete",
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: PASSTHROUGH_COORDINATOR,
    })
    const request = deleteRequest()
    const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
    assert.equal(plan.current?.presentation, "single-attachment")
    assert.equal(plan.current?.attachment?.filename, "private-report.txt")
    assert.doesNotMatch(JSON.stringify(plan.current), /private-file|private-proxy/)

    const result = await service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    )
    assert.equal(result.status, "completed")
    assert.equal(calls.filter((call) => call === "delete-message").length, 1)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("direct-message edit and deletion reject messages not owned by the connector", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-dm-owner-"))
  try {
    const service = new DirectMessageService({
      activityStore: new MemoryActivityStore(),
      client: clientFixture({
        message: rawMessage({
          author: {
            id: RECIPIENT_ID,
            username: "Private Recipient",
          },
        }),
      }),
      operationStore: new FileOperationStore(directory),
      policy: policy({ deletion: true, editing: true }),
      verificationKey: directMessageVerificationKey(TOKEN),
      writeCoordinator: PASSTHROUGH_COORDINATOR,
    })

    await assert.rejects(
      () => service.plan(APPLICATION_ID, BOT_ID, {
        action: "edit",
        channelId: CHANNEL_ID,
        message: { content: "replacement", kind: "text" },
        messageId: MESSAGE_ID,
        operationKey: OPERATION_KEY,
        recipientId: RECIPIENT_ID,
        reviewReason: "review exact edit",
      }),
      DirectMessageEvidenceError,
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("direct-message policy never infers recipient scope from another user", () => {
  const scoped = policy({ audit: true })
  assert.doesNotThrow(() => scoped.assertDirectMessageAuditAllowed(RECIPIENT_ID))
  assert.throws(
    () => scoped.assertDirectMessageAuditAllowed(OTHER_RECIPIENT_ID),
    PolicyError,
  )
  assert.throws(
    () => scoped.assertDirectMessageAttachmentAllowed(RECIPIENT_ID),
    /delivery is disabled/,
  )
})
