import { createHash } from "node:crypto"
import { constants } from "node:fs"
import type { BigIntStats } from "node:fs"
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
} from "node:fs/promises"
import { dirname, join } from "node:path"

import {
  CONNECTOR_LIMITS,
  CONTENT_FREE_ERROR_PATTERN,
  CONTENT_FREE_IDENTIFIER_PATTERN,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  GUILD_TEMPLATE_REFERENCE_PATTERN,
  IDEMPOTENCY_KEY_PATTERN,
  INVITE_REFERENCE_PATTERN,
} from "./constants.js"
import { OperationStoreError } from "./errors.js"
import { REVIEWED_PLAN_DIGEST_PATTERN } from "./reviewed-plan.js"

export const OPERATION_KEY_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/

export const OPERATION_KINDS = [
  "announcement-crosspost",
  "announcement-subscription",
  "application-emoji-change",
  "application-intent-enablement",
  "attachment-message",
  "automod-change",
  "bulk-guild-ban",
  "channel-clone",
  "channel-creation",
  "channel-deletion",
  "channel-metadata-change",
  "channel-ordering",
  "channel-permission-overwrite",
  "component-message",
  "direct-message-change",
  "forum-post",
  "forum-tag-change",
  "guild-expression-change",
  "guild-incident-action-change",
  "guild-profile-change",
  "guild-prune",
  "guild-scaffold",
  "guild-settings-change",
  "guild-template-change",
  "integration-deletion",
  "invite-creation",
  "invite-deletion",
  "member-nickname-change",
  "member-moderation",
  "member-role-change",
  "member-voice-change",
  "message-deletion",
  "message-forward",
  "message-pin",
  "native-interaction-command-change",
  "onboarding-change",
  "poll-create",
  "poll-end",
  "reaction-moderation",
  "role-creation",
  "role-configuration",
  "role-deletion",
  "role-ordering",
  "scheduled-event-change",
  "guild-soundboard-change",
  "stage-instance-change",
  "thread-create",
  "thread-governance-change",
  "voice-channel-status-change",
  "welcome-screen-change",
  "webhook-change",
  "webhook-creation",
  "webhook-deletion",
  "webhook-message-deletion",
  "webhook-message-edit",
  "webhook-message-send",
  "widget-settings-change",
] as const

export type OperationKind = typeof OPERATION_KINDS[number]
export type ApplicationOperationKind =
  | "application-emoji-change"
  | "application-intent-enablement"
export type DirectMessageOperationKind = "direct-message-change"
export type GuildOperationKind = Exclude<
  OperationKind,
  ApplicationOperationKind | DirectMessageOperationKind
>
export type StandardGuildOperationKind = Exclude<
  GuildOperationKind,
  "automod-change" | "component-message"
>
export type OperationReceiptStatus = "completed" | "failed" | "pending" | "uncertain"
export type OperationVerification = "drift" | "match" | null

interface OperationReceiptFields {
  activityId: string
  error: string | null
  guildId: string
  operationKeyHash: string
  planDigest: string
  resourceId: string | null
  status: OperationReceiptStatus
  timestamp: string
  verification: OperationVerification
}

export interface StandardOperationReceipt extends OperationReceiptFields {
  kind: StandardGuildOperationKind
  schemaVersion: 1
}

export interface ComponentMessageOperationReceipt extends OperationReceiptFields {
  kind: "component-message"
  requestDigest: string
  schemaVersion: 2
}

export interface AutoModerationOperationReceipt extends OperationReceiptFields {
  kind: "automod-change"
  requestDigest: string
  schemaVersion: 2
}

export type OperationReceipt =
  | AutoModerationOperationReceipt
  | ComponentMessageOperationReceipt
  | StandardOperationReceipt

export interface ApplicationOperationReceipt {
  activityId: string
  applicationId: string
  error: string | null
  kind: ApplicationOperationKind
  operationKeyHash: string
  planDigest: string
  resourceId: string | null
  schemaVersion: 1
  status: OperationReceiptStatus
  timestamp: string
  verification: OperationVerification
}

export const DIRECT_MESSAGE_ACTIONS = [
  "delete",
  "edit",
  "reply",
  "send",
] as const

export type DirectMessageAction = typeof DIRECT_MESSAGE_ACTIONS[number]
export type DirectMessageReceiptStage =
  | "channel-ready"
  | "message-dispatched"
  | "reserved"
  | "terminal"

export interface DirectMessageOperationReceipt {
  action: DirectMessageAction
  activityId: string
  channelId: string | null
  error: string | null
  kind: DirectMessageOperationKind
  messageId: string | null
  operationKeyHash: string
  planDigest: string
  recipientId: string
  replyToMessageId: string | null
  requestDigest: string
  schemaVersion: 2
  stage: DirectMessageReceiptStage
  status: OperationReceiptStatus
  timestamp: string
  verification: OperationVerification
}

export interface OperationReservation {
  created: boolean
  receipt: OperationReceipt
}

export interface OperationStore {
  finish(receipt: OperationReceipt): Promise<void>
  finishApplication?(receipt: ApplicationOperationReceipt): Promise<void>
  checkpointDirectMessage?(receipt: DirectMessageOperationReceipt): Promise<void>
  finishDirectMessage?(receipt: DirectMessageOperationReceipt): Promise<void>
  get(kind: GuildOperationKind, operationKeyHash: string): Promise<OperationReceipt | undefined>
  getApplication?(
    kind: ApplicationOperationKind,
    operationKeyHash: string,
  ): Promise<ApplicationOperationReceipt | undefined>
  getDirectMessage?(
    kind: DirectMessageOperationKind,
    operationKeyHash: string,
  ): Promise<DirectMessageOperationReceipt | undefined>
  reserve(receipt: OperationReceipt): Promise<OperationReservation>
  reserveApplication?(
    receipt: ApplicationOperationReceipt,
  ): Promise<ApplicationOperationReservation>
  reserveDirectMessage?(
    receipt: DirectMessageOperationReceipt,
  ): Promise<DirectMessageOperationReservation>
}

export interface ApplicationOperationReservation {
  created: boolean
  receipt: ApplicationOperationReceipt
}

export interface DirectMessageOperationReservation {
  created: boolean
  receipt: DirectMessageOperationReceipt
}

export interface ApplicationOperationStore extends OperationStore {
  finishApplication(receipt: ApplicationOperationReceipt): Promise<void>
  getApplication(
    kind: ApplicationOperationKind,
    operationKeyHash: string,
  ): Promise<ApplicationOperationReceipt | undefined>
  reserveApplication(
    receipt: ApplicationOperationReceipt,
  ): Promise<ApplicationOperationReservation>
}

export interface DirectMessageOperationStore extends OperationStore {
  checkpointDirectMessage(receipt: DirectMessageOperationReceipt): Promise<void>
  finishDirectMessage(receipt: DirectMessageOperationReceipt): Promise<void>
  getDirectMessage(
    kind: DirectMessageOperationKind,
    operationKeyHash: string,
  ): Promise<DirectMessageOperationReceipt | undefined>
  reserveDirectMessage(
    receipt: DirectMessageOperationReceipt,
  ): Promise<DirectMessageOperationReservation>
}

const APPLICATION_OPERATION_KINDS: readonly ApplicationOperationKind[] = [
  "application-emoji-change",
  "application-intent-enablement",
]

export function isApplicationOperationKind(
  kind: OperationKind,
): kind is ApplicationOperationKind {
  return (APPLICATION_OPERATION_KINDS as readonly OperationKind[]).includes(kind)
}

export function isDirectMessageOperationKind(
  kind: OperationKind,
): kind is DirectMessageOperationKind {
  return kind === "direct-message-change"
}

const GUILD_OPERATION_KINDS = OPERATION_KINDS.filter(
  (kind): kind is GuildOperationKind => (
    !isApplicationOperationKind(kind) && !isDirectMessageOperationKind(kind)
  ),
)

const OPERATION_RECEIPT_SCHEMA_VERSION = 1
const REQUEST_BOUND_RECEIPT_SCHEMA_VERSION = 2
const RECEIPT_KEYS = [
  "activityId",
  "error",
  "guildId",
  "kind",
  "operationKeyHash",
  "planDigest",
  "resourceId",
  "schemaVersion",
  "status",
  "timestamp",
  "verification",
] as const
const REQUEST_BOUND_RECEIPT_KEYS = [
  ...RECEIPT_KEYS,
  "requestDigest",
] as const

const APPLICATION_RECEIPT_KEYS = [
  "activityId",
  "applicationId",
  "error",
  "kind",
  "operationKeyHash",
  "planDigest",
  "resourceId",
  "schemaVersion",
  "status",
  "timestamp",
  "verification",
] as const

const DIRECT_MESSAGE_RECEIPT_KEYS = [
  "action",
  "activityId",
  "channelId",
  "error",
  "kind",
  "messageId",
  "operationKeyHash",
  "planDigest",
  "recipientId",
  "replyToMessageId",
  "requestDigest",
  "schemaVersion",
  "stage",
  "status",
  "timestamp",
  "verification",
] as const

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === code
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
}

function parseReceipt(value: unknown): OperationReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OperationStoreError("Discord operation receipt is not an object")
  }
  const record = value as Record<string, unknown>
  const requestBound = ["automod-change", "component-message"].includes(
    String(record.kind),
  )
  const expectedKeys = requestBound
    ? REQUEST_BOUND_RECEIPT_KEYS
    : RECEIPT_KEYS
  if (
    Object.keys(record).sort().join("\0") !== [...expectedKeys].sort().join("\0")
    || (requestBound
      ? record.schemaVersion !== REQUEST_BOUND_RECEIPT_SCHEMA_VERSION
        || typeof record.requestDigest !== "string"
        || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.requestDigest)
      : record.schemaVersion !== OPERATION_RECEIPT_SCHEMA_VERSION)
    || !GUILD_OPERATION_KINDS.includes(record.kind as GuildOperationKind)
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.activityId !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.activityId)
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.resourceId === null || (
      typeof record.resourceId === "string"
      && (
        record.kind === "invite-creation" || record.kind === "invite-deletion"
          ? INVITE_REFERENCE_PATTERN.test(record.resourceId)
          : record.kind === "guild-template-change"
            ? GUILD_TEMPLATE_REFERENCE_PATTERN.test(record.resourceId)
          : DISCORD_SNOWFLAKE_PATTERN.test(record.resourceId)
      )
    ))
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || !validTimestamp(record.timestamp)
  ) {
    throw new OperationStoreError("Discord operation receipt has an invalid shape")
  }
  if (record.status === "pending" && (
    record.error !== null
    || record.resourceId !== null
    || record.verification !== null
  )) {
    throw new OperationStoreError("Pending Discord operation receipt contains terminal state")
  }
  if (record.status === "completed" && (
    record.error !== null
    || record.resourceId === null
    || !["drift", "match"].includes(String(record.verification))
  )) {
    throw new OperationStoreError("Completed Discord operation receipt lacks verified state")
  }
  if (record.status === "failed" && (
    record.error === null
    || record.resourceId !== null
  )) {
    throw new OperationStoreError("Failed Discord operation receipt has invalid outcome state")
  }
  if (record.status === "uncertain" && record.error === null) {
    throw new OperationStoreError("Uncertain Discord operation receipt lacks an error category")
  }
  if (record.status !== "completed" && record.verification !== null) {
    throw new OperationStoreError("Incomplete Discord operation receipt contains verification state")
  }
  if (
    [
      "attachment-message",
      "component-message",
      "webhook-message-edit",
      "webhook-message-send",
    ].includes(record.kind as string)
    && record.verification === "drift"
  ) {
    throw new OperationStoreError("Discord exact-message receipt cannot contain drift verification")
  }
  const common = {
    activityId: record.activityId,
    error: record.error,
    guildId: record.guildId,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    resourceId: record.resourceId,
    status: record.status as OperationReceiptStatus,
    timestamp: record.timestamp,
    verification: record.verification as OperationVerification,
  }
  if (record.kind === "component-message") {
    return {
      ...common,
      kind: "component-message",
      requestDigest: record.requestDigest as string,
      schemaVersion: REQUEST_BOUND_RECEIPT_SCHEMA_VERSION,
    }
  }
  if (record.kind === "automod-change") {
    return {
      ...common,
      kind: "automod-change",
      requestDigest: record.requestDigest as string,
      schemaVersion: REQUEST_BOUND_RECEIPT_SCHEMA_VERSION,
    }
  }
  return {
    ...common,
    kind: record.kind as StandardGuildOperationKind,
    schemaVersion: OPERATION_RECEIPT_SCHEMA_VERSION,
  }
}

function parseApplicationReceipt(value: unknown): ApplicationOperationReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OperationStoreError("Discord application operation receipt is not an object")
  }
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).sort().join("\0")
      !== [...APPLICATION_RECEIPT_KEYS].sort().join("\0")
    || record.schemaVersion !== OPERATION_RECEIPT_SCHEMA_VERSION
    || typeof record.kind !== "string"
    || !(APPLICATION_OPERATION_KINDS as readonly string[]).includes(record.kind)
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.activityId !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.activityId)
    || typeof record.applicationId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.applicationId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.resourceId === null || (
      typeof record.resourceId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.resourceId)
    ))
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || !validTimestamp(record.timestamp)
  ) {
    throw new OperationStoreError("Discord application operation receipt has an invalid shape")
  }
  if (record.status === "pending" && (
    record.error !== null
    || record.resourceId !== null
    || record.verification !== null
  )) {
    throw new OperationStoreError(
      "Pending Discord application operation receipt contains terminal state",
    )
  }
  if (record.status === "completed" && (
    record.error !== null
    || record.resourceId === null
    || !["drift", "match"].includes(String(record.verification))
  )) {
    throw new OperationStoreError(
      "Completed Discord application operation receipt lacks verified state",
    )
  }
  if (record.status === "failed" && (
    record.error === null
    || record.resourceId !== null
  )) {
    throw new OperationStoreError(
      "Failed Discord application operation receipt has invalid outcome state",
    )
  }
  if (record.status === "uncertain" && record.error === null) {
    throw new OperationStoreError(
      "Uncertain Discord application operation receipt lacks an error category",
    )
  }
  if (record.status !== "completed" && record.verification !== null) {
    throw new OperationStoreError(
      "Incomplete Discord application operation receipt contains verification state",
    )
  }
  if (
    record.kind === "application-intent-enablement"
    && (
      record.verification === "drift"
      || (
        ["completed", "uncertain"].includes(String(record.status))
        && record.resourceId !== record.applicationId
      )
    )
  ) {
    throw new OperationStoreError(
      "Discord application intent receipt has invalid application-wide outcome evidence",
    )
  }
  return {
    activityId: record.activityId,
    applicationId: record.applicationId,
    error: record.error,
    kind: record.kind as ApplicationOperationKind,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    resourceId: record.resourceId,
    schemaVersion: OPERATION_RECEIPT_SCHEMA_VERSION,
    status: record.status as OperationReceiptStatus,
    timestamp: record.timestamp,
    verification: record.verification as OperationVerification,
  }
}

function validSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) > 0n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function nullableSnowflake(value: unknown): value is string | null {
  return value === null || validSnowflake(value)
}

function parseDirectMessageReceipt(value: unknown): DirectMessageOperationReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OperationStoreError(
      "Discord direct-message operation receipt is not an object",
    )
  }
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).sort().join("\0")
      !== [...DIRECT_MESSAGE_RECEIPT_KEYS].sort().join("\0")
    || record.schemaVersion !== REQUEST_BOUND_RECEIPT_SCHEMA_VERSION
    || record.kind !== "direct-message-change"
    || !(DIRECT_MESSAGE_ACTIONS as readonly unknown[]).includes(record.action)
    || !["channel-ready", "message-dispatched", "reserved", "terminal"]
      .includes(String(record.stage))
    || !["completed", "failed", "pending", "uncertain"]
      .includes(String(record.status))
    || typeof record.activityId !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.activityId)
    || !validSnowflake(record.recipientId)
    || !nullableSnowflake(record.channelId)
    || !nullableSnowflake(record.messageId)
    || !nullableSnowflake(record.replyToMessageId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || typeof record.requestDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.requestDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || !validTimestamp(record.timestamp)
  ) {
    throw new OperationStoreError(
      "Discord direct-message operation receipt has an invalid shape",
    )
  }
  const action = record.action as DirectMessageAction
  const stage = record.stage as DirectMessageReceiptStage
  const status = record.status as OperationReceiptStatus
  const channelId = record.channelId as string | null
  const messageId = record.messageId as string | null
  const replyToMessageId = record.replyToMessageId as string | null
  if (
    (action === "reply" && replyToMessageId === null)
    || (["delete", "send"].includes(action) && replyToMessageId !== null)
  ) {
    throw new OperationStoreError(
      "Discord direct-message operation receipt has invalid reply identity",
    )
  }
  if (action !== "send" && channelId === null) {
    throw new OperationStoreError(
      "Discord direct-message operation receipt lacks its exact channel identity",
    )
  }
  if (["delete", "edit"].includes(action) && messageId === null) {
    throw new OperationStoreError(
      "Discord direct-message operation receipt lacks its exact message identity",
    )
  }
  if ((stage === "terminal") !== (status !== "pending")) {
    throw new OperationStoreError(
      "Discord direct-message operation receipt stage and status disagree",
    )
  }
  if (status === "pending" && (
    record.error !== null
    || record.verification !== null
  )) {
    throw new OperationStoreError(
      "Pending Discord direct-message receipt contains terminal state",
    )
  }
  if (stage === "reserved" && (
    (action === "send" && (channelId !== null || messageId !== null))
    || (action === "reply" && messageId !== null)
  )) {
    throw new OperationStoreError(
      "Reserved Discord direct-message receipt contains dispatched identity",
    )
  }
  if (stage === "channel-ready" && (
    action !== "send"
    || channelId === null
    || messageId !== null
  )) {
    throw new OperationStoreError(
      "Discord direct-message channel checkpoint has invalid identity",
    )
  }
  if (stage === "message-dispatched" && (
    channelId === null
    || messageId === null
  )) {
    throw new OperationStoreError(
      "Discord direct-message dispatch checkpoint lacks exact identity",
    )
  }
  if (status === "completed" && (
    record.error !== null
    || record.verification !== "match"
    || channelId === null
    || messageId === null
  )) {
    throw new OperationStoreError(
      "Completed Discord direct-message receipt lacks verified state",
    )
  }
  if (["failed", "uncertain"].includes(status) && (
    record.error === null
    || record.verification !== null
  )) {
    throw new OperationStoreError(
      "Incomplete Discord direct-message receipt lacks a safe outcome category",
    )
  }
  return {
    action,
    activityId: record.activityId,
    channelId,
    error: record.error as string | null,
    kind: "direct-message-change",
    messageId,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    recipientId: record.recipientId,
    replyToMessageId,
    requestDigest: record.requestDigest,
    schemaVersion: REQUEST_BOUND_RECEIPT_SCHEMA_VERSION,
    stage,
    status,
    timestamp: record.timestamp,
    verification: record.verification as OperationVerification,
  }
}

function assertIdentity(
  pending: OperationReceipt,
  terminal: OperationReceipt,
): void {
  if (
    pending.activityId !== terminal.activityId
    || pending.guildId !== terminal.guildId
    || pending.kind !== terminal.kind
    || pending.operationKeyHash !== terminal.operationKeyHash
    || pending.planDigest !== terminal.planDigest
    || pending.schemaVersion !== terminal.schemaVersion
    || ("requestDigest" in pending && (
      !("requestDigest" in terminal)
      || pending.requestDigest !== terminal.requestDigest
    ))
  ) {
    throw new OperationStoreError("Discord operation terminal receipt changed reserved identity")
  }
  if (terminal.status === "pending") {
    throw new OperationStoreError("Discord operation terminal receipt is still pending")
  }
}

function sameTerminal(left: OperationReceipt, right: OperationReceipt): boolean {
  return left.activityId === right.activityId
    && left.error === right.error
    && left.guildId === right.guildId
    && left.kind === right.kind
    && left.operationKeyHash === right.operationKeyHash
    && left.planDigest === right.planDigest
    && left.resourceId === right.resourceId
    && left.schemaVersion === right.schemaVersion
    && left.status === right.status
    && left.verification === right.verification
    && (!("requestDigest" in left) || (
      "requestDigest" in right
      && left.requestDigest === right.requestDigest
    ))
}

function assertApplicationIdentity(
  pending: ApplicationOperationReceipt,
  terminal: ApplicationOperationReceipt,
): void {
  if (
    pending.activityId !== terminal.activityId
    || pending.applicationId !== terminal.applicationId
    || pending.kind !== terminal.kind
    || pending.operationKeyHash !== terminal.operationKeyHash
    || pending.planDigest !== terminal.planDigest
  ) {
    throw new OperationStoreError(
      "Discord application operation terminal receipt changed reserved identity",
    )
  }
  if (terminal.status === "pending") {
    throw new OperationStoreError(
      "Discord application operation terminal receipt is still pending",
    )
  }
}

function sameApplicationTerminal(
  left: ApplicationOperationReceipt,
  right: ApplicationOperationReceipt,
): boolean {
  return left.activityId === right.activityId
    && left.applicationId === right.applicationId
    && left.error === right.error
    && left.kind === right.kind
    && left.operationKeyHash === right.operationKeyHash
    && left.planDigest === right.planDigest
    && left.resourceId === right.resourceId
    && left.status === right.status
    && left.verification === right.verification
}

const DIRECT_MESSAGE_STAGE_ORDER: Readonly<Record<
  DirectMessageReceiptStage,
  number
>> = Object.freeze({
  "channel-ready": 1,
  "message-dispatched": 2,
  reserved: 0,
  terminal: 3,
})

function assertDirectMessageIdentity(
  reserved: DirectMessageOperationReceipt,
  next: DirectMessageOperationReceipt,
): void {
  if (
    reserved.action !== next.action
    || reserved.activityId !== next.activityId
    || reserved.kind !== next.kind
    || reserved.operationKeyHash !== next.operationKeyHash
    || reserved.planDigest !== next.planDigest
    || reserved.recipientId !== next.recipientId
    || reserved.replyToMessageId !== next.replyToMessageId
    || reserved.requestDigest !== next.requestDigest
    || reserved.schemaVersion !== next.schemaVersion
    || (reserved.channelId !== null && reserved.channelId !== next.channelId)
    || (reserved.messageId !== null && reserved.messageId !== next.messageId)
  ) {
    throw new OperationStoreError(
      "Discord direct-message receipt changed reserved identity",
    )
  }
}

function assertDirectMessageAdvance(
  current: DirectMessageOperationReceipt,
  next: DirectMessageOperationReceipt,
): void {
  assertDirectMessageIdentity(current, next)
  if (
    DIRECT_MESSAGE_STAGE_ORDER[next.stage]
      <= DIRECT_MESSAGE_STAGE_ORDER[current.stage]
    || (
      current.action === "send"
      && next.stage === "message-dispatched"
      && current.stage !== "channel-ready"
    )
    || (
      next.status === "completed"
      && current.stage !== "message-dispatched"
    )
  ) {
    throw new OperationStoreError(
      "Discord direct-message receipt stage did not advance safely",
    )
  }
}

function sameDirectMessageReceipt(
  left: DirectMessageOperationReceipt,
  right: DirectMessageOperationReceipt,
): boolean {
  return left.action === right.action
    && left.activityId === right.activityId
    && left.channelId === right.channelId
    && left.error === right.error
    && left.kind === right.kind
    && left.messageId === right.messageId
    && left.operationKeyHash === right.operationKeyHash
    && left.planDigest === right.planDigest
    && left.recipientId === right.recipientId
    && left.replyToMessageId === right.replyToMessageId
    && left.requestDigest === right.requestDigest
    && left.schemaVersion === right.schemaVersion
    && left.stage === right.stage
    && left.status === right.status
    && left.timestamp === right.timestamp
    && left.verification === right.verification
}

export function operationKeyHash(operationKey: string): string {
  if (
    typeof operationKey !== "string"
    || operationKey.length < CONNECTOR_LIMITS.idempotencyKeyMinimumCharacters
    || operationKey.length > CONNECTOR_LIMITS.idempotencyKeyCharacters
    || !IDEMPOTENCY_KEY_PATTERN.test(operationKey)
  ) {
    throw new RangeError(
      `Discord operation key must be ${CONNECTOR_LIMITS.idempotencyKeyMinimumCharacters}-${CONNECTOR_LIMITS.idempotencyKeyCharacters} safe ASCII characters`,
    )
  }
  return `sha256:${createHash("sha256")
    .update("discord-mcp-operation-key.v1\0")
    .update(operationKey)
    .digest("hex")}`
}

export function operationReceiptDirectory(activityFile: string): string {
  return `${activityFile}.operations`
}

function receiptStem(kind: OperationKind, hash: string): string {
  if (!OPERATION_KINDS.includes(kind) || !OPERATION_KEY_HASH_PATTERN.test(hash)) {
    throw new OperationStoreError("Discord operation receipt identity is invalid")
  }
  return `${kind}-${hash.slice("sha256:".length)}`
}

async function readReceiptFile<T = OperationReceipt>(
  file: string,
  parser: (value: unknown) => T = parseReceipt as (value: unknown) => T,
): Promise<T | undefined> {
  let before: BigIntStats
  try {
    before = await lstat(file, { bigint: true })
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined
    throw new OperationStoreError("Unable to inspect Discord operation receipt", { cause: error })
  }
  if (
    !before.isFile()
    || before.isSymbolicLink()
    || before.nlink !== 1n
    || (before.mode & 0o077n) !== 0n
    || before.size < 2n
    || before.size > BigInt(CONNECTOR_LIMITS.operationReceiptBytes)
    || (
      typeof process.getuid === "function"
      && before.uid !== BigInt(process.getuid())
    )
  ) {
    throw new OperationStoreError("Discord operation receipt is not a private regular file")
  }
  let handle
  try {
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
    handle = await open(file, constants.O_RDONLY | noFollow)
    const opened = await handle.stat({ bigint: true })
    if (
      !opened.isFile()
      || opened.isSymbolicLink()
      || opened.nlink !== 1n
      || (opened.mode & 0o077n) !== 0n
      || opened.size < 2n
      || opened.size > BigInt(CONNECTOR_LIMITS.operationReceiptBytes)
      || (
        typeof process.getuid === "function"
        && opened.uid !== BigInt(process.getuid())
      )
      || opened.dev !== before.dev
      || opened.ino !== before.ino
    ) {
      throw new OperationStoreError(
        "Discord operation receipt changed while it was opened",
      )
    }
    const bytes = await handle.readFile()
    const afterRead = await handle.stat({ bigint: true })
    const afterPath = await lstat(file, { bigint: true })
    if (
      bytes.byteLength !== Number(opened.size)
      || !sameReceiptMetadata(opened, afterRead)
      || !sameReceiptMetadata(afterRead, afterPath)
    ) {
      throw new OperationStoreError(
        "Discord operation receipt changed while it was read",
      )
    }
    const text = bytes.toString("utf8")
    const lines = text.split("\n")
    if (lines.length !== 2 || !lines[0] || lines[1] !== "") {
      throw new OperationStoreError("Discord operation receipt is not one complete record")
    }
    try {
      return parser(JSON.parse(lines[0]) as unknown)
    } catch (error) {
      if (error instanceof OperationStoreError) throw error
      throw new OperationStoreError("Discord operation receipt is not valid JSON", { cause: error })
    }
  } catch (error) {
    if (error instanceof OperationStoreError) throw error
    throw new OperationStoreError("Unable to read Discord operation receipt", { cause: error })
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function sameReceiptMetadata(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.uid === right.uid
    && left.gid === right.gid
    && left.size === right.size
    && left.ctimeNs === right.ctimeNs
    && left.mtimeNs === right.mtimeNs
}

async function syncDirectory(directory: string): Promise<void> {
  let handle
  try {
    handle = await open(directory, "r")
    await handle.sync()
  } catch (error) {
    throw new OperationStoreError("Unable to sync Discord operation receipt", { cause: error })
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function writeExclusive(
  file: string,
  receipt:
    | ApplicationOperationReceipt
    | DirectMessageOperationReceipt
    | OperationReceipt,
): Promise<boolean> {
  let handle
  try {
    handle = await open(file, "wx", 0o600)
    await handle.writeFile(`${JSON.stringify(receipt)}\n`, "utf8")
    await handle.sync()
  } catch (error) {
    if (isNodeError(error, "EEXIST")) return false
    throw new OperationStoreError("Unable to write Discord operation receipt", { cause: error })
  } finally {
    await handle?.close().catch(() => undefined)
  }
  await syncDirectory(dirname(file))
  return true
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false
    throw new OperationStoreError("Unable to inspect Discord operation receipt", { cause: error })
  }
}

async function publishReceiptDirectory(
  parent: string,
  target: string,
  receiptFile: string,
  receipt:
    | ApplicationOperationReceipt
    | DirectMessageOperationReceipt
    | OperationReceipt,
): Promise<boolean> {
  let staging: string
  try {
    staging = await mkdtemp(join(parent, ".operation-receipt-"))
  } catch (error) {
    throw new OperationStoreError("Unable to stage Discord operation receipt", { cause: error })
  }
  let published = false
  try {
    if (!await writeExclusive(join(staging, receiptFile), receipt)) {
      throw new OperationStoreError("Discord operation staging receipt already exists")
    }
    try {
      await rename(staging, target)
      published = true
    } catch (error) {
      if (await pathExists(target)) return false
      throw new OperationStoreError("Unable to publish Discord operation receipt", { cause: error })
    }
    await syncDirectory(parent)
    return true
  } finally {
    if (!published) {
      await rm(staging, { force: true, recursive: true }).catch(() => undefined)
    }
  }
}

async function assertPrivateDirectory(
  directory: string,
  missingAllowed: boolean,
): Promise<boolean> {
  let metadata
  try {
    metadata = await lstat(directory)
  } catch (error) {
    if (missingAllowed && isNodeError(error, "ENOENT")) return false
    throw new OperationStoreError("Unable to inspect Discord operation directory", { cause: error })
  }
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || (metadata.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new OperationStoreError("Discord operation directory is not private")
  }
  return true
}

async function readTerminalReceipt<T = OperationReceipt>(
  directory: string,
  receiptFile: string,
  parser: (value: unknown) => T = parseReceipt as (value: unknown) => T,
): Promise<T | undefined> {
  if (!await assertPrivateDirectory(directory, true)) return undefined
  const receipt = await readReceiptFile(join(directory, receiptFile), parser)
  if (!receipt) {
    throw new OperationStoreError("Discord operation terminal directory has no receipt")
  }
  return receipt
}

export class FileOperationStore implements
  ApplicationOperationStore,
  DirectMessageOperationStore {
  readonly #directory: string

  constructor(directory: string) {
    this.#directory = directory
  }

  async #assertDirectory(create: boolean): Promise<boolean> {
    if (create) {
      try {
        await mkdir(this.#directory, { mode: 0o700, recursive: true })
      } catch (error) {
        throw new OperationStoreError("Unable to create Discord operation directory", { cause: error })
      }
    }
    return assertPrivateDirectory(this.#directory, !create)
  }

  #paths(kind: OperationKind, hash: string) {
    const stem = receiptStem(kind, hash)
    const operation = join(this.#directory, stem)
    const terminalDirectory = join(operation, "terminal")
    return {
      operation,
      pending: join(operation, "pending.json"),
      terminalDirectory,
    }
  }

  async get(
    kind: GuildOperationKind,
    hash: string,
  ): Promise<OperationReceipt | undefined> {
    if (!await this.#assertDirectory(false)) return undefined
    const paths = this.#paths(kind, hash)
    if (!await assertPrivateDirectory(paths.operation, true)) return undefined
    const [pending, terminal] = await Promise.all([
      readReceiptFile(paths.pending),
      readTerminalReceipt(paths.terminalDirectory, "receipt.json"),
    ])
    if (!pending) {
      throw new OperationStoreError("Discord operation directory has no reservation")
    }
    if (pending.status !== "pending") {
      throw new OperationStoreError("Discord operation reservation is not pending")
    }
    if (!terminal) return pending
    assertIdentity(pending, terminal)
    return terminal
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    const normalized = parseReceipt(receipt)
    if (normalized.status !== "pending") {
      throw new OperationStoreError("Discord operation reservation must be pending")
    }
    await this.#assertDirectory(true)
    const paths = this.#paths(normalized.kind, normalized.operationKeyHash)
    const created = await publishReceiptDirectory(
      this.#directory,
      paths.operation,
      "pending.json",
      normalized,
    )
    if (created) return { created: true, receipt: normalized }
    const existing = await this.get(normalized.kind, normalized.operationKeyHash)
    if (!existing) {
      throw new OperationStoreError("Discord operation reservation disappeared")
    }
    return { created: false, receipt: existing }
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    const normalized = parseReceipt(receipt)
    if (normalized.status === "pending") {
      throw new OperationStoreError("Discord operation terminal receipt cannot be pending")
    }
    await this.#assertDirectory(true)
    const paths = this.#paths(normalized.kind, normalized.operationKeyHash)
    if (!await assertPrivateDirectory(paths.operation, true)) {
      throw new OperationStoreError("Discord operation has no reservation")
    }
    const pending = await readReceiptFile(paths.pending)
    if (!pending) {
      throw new OperationStoreError("Discord operation has no reservation")
    }
    assertIdentity(pending, normalized)
    if (await publishReceiptDirectory(
      paths.operation,
      paths.terminalDirectory,
      "receipt.json",
      normalized,
    )) return
    const existing = await readTerminalReceipt(
      paths.terminalDirectory,
      "receipt.json",
    )
    if (!existing) {
      throw new OperationStoreError("Discord operation terminal receipt disappeared")
    }
    assertIdentity(pending, existing)
    if (!sameTerminal(existing, normalized)) {
      throw new OperationStoreError("Discord operation already has a different terminal receipt")
    }
  }

  async getDirectMessage(
    kind: DirectMessageOperationKind,
    hash: string,
  ): Promise<DirectMessageOperationReceipt | undefined> {
    if (!await this.#assertDirectory(false)) return undefined
    const paths = this.#paths(kind, hash)
    if (!await assertPrivateDirectory(paths.operation, true)) return undefined
    const [reserved, channelReady, messageDispatched, terminal] = await Promise.all([
      readReceiptFile(paths.pending, parseDirectMessageReceipt),
      readTerminalReceipt(
        join(paths.operation, "channel-ready"),
        "receipt.json",
        parseDirectMessageReceipt,
      ),
      readTerminalReceipt(
        join(paths.operation, "message-dispatched"),
        "receipt.json",
        parseDirectMessageReceipt,
      ),
      readTerminalReceipt(
        paths.terminalDirectory,
        "receipt.json",
        parseDirectMessageReceipt,
      ),
    ])
    if (!reserved || reserved.stage !== "reserved" || reserved.status !== "pending") {
      throw new OperationStoreError(
        "Discord direct-message operation has no valid reservation",
      )
    }
    let current = reserved
    if (channelReady) {
      assertDirectMessageAdvance(current, channelReady)
      current = channelReady
    }
    if (messageDispatched) {
      assertDirectMessageAdvance(current, messageDispatched)
      current = messageDispatched
    }
    if (!terminal) return current
    assertDirectMessageAdvance(current, terminal)
    return terminal
  }

  async reserveDirectMessage(
    receipt: DirectMessageOperationReceipt,
  ): Promise<DirectMessageOperationReservation> {
    const normalized = parseDirectMessageReceipt(receipt)
    if (normalized.status !== "pending" || normalized.stage !== "reserved") {
      throw new OperationStoreError(
        "Discord direct-message reservation must be pending and reserved",
      )
    }
    await this.#assertDirectory(true)
    const paths = this.#paths(normalized.kind, normalized.operationKeyHash)
    const created = await publishReceiptDirectory(
      this.#directory,
      paths.operation,
      "pending.json",
      normalized,
    )
    if (created) return { created: true, receipt: normalized }
    const existing = await this.getDirectMessage(
      normalized.kind,
      normalized.operationKeyHash,
    )
    if (!existing) {
      throw new OperationStoreError(
        "Discord direct-message reservation disappeared",
      )
    }
    return { created: false, receipt: existing }
  }

  async checkpointDirectMessage(
    receipt: DirectMessageOperationReceipt,
  ): Promise<void> {
    const normalized = parseDirectMessageReceipt(receipt)
    if (
      normalized.status !== "pending"
      || !["channel-ready", "message-dispatched"].includes(normalized.stage)
    ) {
      throw new OperationStoreError(
        "Discord direct-message checkpoint must be a supported pending stage",
      )
    }
    await this.#assertDirectory(true)
    const paths = this.#paths(normalized.kind, normalized.operationKeyHash)
    const current = await this.getDirectMessage(
      normalized.kind,
      normalized.operationKeyHash,
    )
    if (!current) {
      throw new OperationStoreError(
        "Discord direct-message checkpoint has no reservation",
      )
    }
    if (current.stage === "terminal") {
      throw new OperationStoreError(
        "Discord direct-message operation is already terminal",
      )
    }
    if (current.stage === normalized.stage) {
      if (!sameDirectMessageReceipt(current, normalized)) {
        throw new OperationStoreError(
          "Discord direct-message checkpoint already has different evidence",
        )
      }
      return
    }
    assertDirectMessageAdvance(current, normalized)
    const target = join(paths.operation, normalized.stage)
    if (await publishReceiptDirectory(
      paths.operation,
      target,
      "receipt.json",
      normalized,
    )) return
    const existing = await readTerminalReceipt(
      target,
      "receipt.json",
      parseDirectMessageReceipt,
    )
    if (!existing || !sameDirectMessageReceipt(existing, normalized)) {
      throw new OperationStoreError(
        "Discord direct-message checkpoint already has different evidence",
      )
    }
  }

  async finishDirectMessage(
    receipt: DirectMessageOperationReceipt,
  ): Promise<void> {
    const normalized = parseDirectMessageReceipt(receipt)
    if (normalized.status === "pending" || normalized.stage !== "terminal") {
      throw new OperationStoreError(
        "Discord direct-message terminal receipt is not terminal",
      )
    }
    await this.#assertDirectory(true)
    const paths = this.#paths(normalized.kind, normalized.operationKeyHash)
    const current = await this.getDirectMessage(
      normalized.kind,
      normalized.operationKeyHash,
    )
    if (!current) {
      throw new OperationStoreError(
        "Discord direct-message operation has no reservation",
      )
    }
    if (current.stage === "terminal") {
      if (!sameDirectMessageReceipt(current, normalized)) {
        throw new OperationStoreError(
          "Discord direct-message operation already has a different terminal receipt",
        )
      }
      return
    }
    assertDirectMessageAdvance(current, normalized)
    if (await publishReceiptDirectory(
      paths.operation,
      paths.terminalDirectory,
      "receipt.json",
      normalized,
    )) return
    const existing = await readTerminalReceipt(
      paths.terminalDirectory,
      "receipt.json",
      parseDirectMessageReceipt,
    )
    if (!existing || !sameDirectMessageReceipt(existing, normalized)) {
      throw new OperationStoreError(
        "Discord direct-message operation already has a different terminal receipt",
      )
    }
  }

  async getApplication(
    kind: ApplicationOperationKind,
    hash: string,
  ): Promise<ApplicationOperationReceipt | undefined> {
    if (!await this.#assertDirectory(false)) return undefined
    const paths = this.#paths(kind, hash)
    if (!await assertPrivateDirectory(paths.operation, true)) return undefined
    const [pending, terminal] = await Promise.all([
      readReceiptFile(paths.pending, parseApplicationReceipt),
      readTerminalReceipt(
        paths.terminalDirectory,
        "receipt.json",
        parseApplicationReceipt,
      ),
    ])
    if (!pending) {
      throw new OperationStoreError(
        "Discord application operation directory has no reservation",
      )
    }
    if (pending.status !== "pending") {
      throw new OperationStoreError(
        "Discord application operation reservation is not pending",
      )
    }
    if (!terminal) return pending
    assertApplicationIdentity(pending, terminal)
    return terminal
  }

  async reserveApplication(
    receipt: ApplicationOperationReceipt,
  ): Promise<ApplicationOperationReservation> {
    const normalized = parseApplicationReceipt(receipt)
    if (normalized.status !== "pending") {
      throw new OperationStoreError(
        "Discord application operation reservation must be pending",
      )
    }
    await this.#assertDirectory(true)
    const paths = this.#paths(normalized.kind, normalized.operationKeyHash)
    const created = await publishReceiptDirectory(
      this.#directory,
      paths.operation,
      "pending.json",
      normalized,
    )
    if (created) return { created: true, receipt: normalized }
    const existing = await this.getApplication(
      normalized.kind,
      normalized.operationKeyHash,
    )
    if (!existing) {
      throw new OperationStoreError(
        "Discord application operation reservation disappeared",
      )
    }
    return { created: false, receipt: existing }
  }

  async finishApplication(receipt: ApplicationOperationReceipt): Promise<void> {
    const normalized = parseApplicationReceipt(receipt)
    if (normalized.status === "pending") {
      throw new OperationStoreError(
        "Discord application operation terminal receipt cannot be pending",
      )
    }
    await this.#assertDirectory(true)
    const paths = this.#paths(normalized.kind, normalized.operationKeyHash)
    if (!await assertPrivateDirectory(paths.operation, true)) {
      throw new OperationStoreError(
        "Discord application operation has no reservation",
      )
    }
    const pending = await readReceiptFile(
      paths.pending,
      parseApplicationReceipt,
    )
    if (!pending) {
      throw new OperationStoreError(
        "Discord application operation has no reservation",
      )
    }
    assertApplicationIdentity(pending, normalized)
    if (await publishReceiptDirectory(
      paths.operation,
      paths.terminalDirectory,
      "receipt.json",
      normalized,
    )) return
    const existing = await readTerminalReceipt(
      paths.terminalDirectory,
      "receipt.json",
      parseApplicationReceipt,
    )
    if (!existing) {
      throw new OperationStoreError(
        "Discord application operation terminal receipt disappeared",
      )
    }
    assertApplicationIdentity(pending, existing)
    if (!sameApplicationTerminal(existing, normalized)) {
      throw new OperationStoreError(
        "Discord application operation already has a different terminal receipt",
      )
    }
  }
}
