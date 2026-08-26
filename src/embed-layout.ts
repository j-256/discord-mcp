import { stableString } from "./normalize.js"
import {
  canonicalDiscordNotificationUserIds,
  discordMentionedUserIds,
} from "./message-safety.js"

export const EMBED_LAYOUT_LIMITS = Object.freeze({
  aggregateCharacters: 6_000,
  authorNameCharacters: 256,
  descriptionCharacters: 4_096,
  embeds: 10,
  fieldNameCharacters: 256,
  fields: 25,
  fieldValueCharacters: 1_024,
  footerTextCharacters: 2_048,
  requestBytes: 65_536,
  titleCharacters: 256,
})

export interface EmbedFieldInput {
  inline?: boolean
  name: string
  value: string
}

export interface EmbedLayoutInput {
  authorName?: string
  color?: number
  description?: string
  fields?: readonly EmbedFieldInput[]
  footerText?: string
  timestamp?: string
  title?: string
}

export interface NormalizedEmbedField {
  inline: boolean
  name: string
  value: string
}

export interface NormalizedEmbed {
  authorName: string | null
  color: number | null
  description: string | null
  fields: NormalizedEmbedField[]
  footerText: string | null
  timestamp: string | null
  title: string | null
}

export type NormalizedEmbedLayout = NormalizedEmbed[]

export interface NormalizedEmbedPresentation {
  content: string | null
  embeds: NormalizedEmbedLayout
}

export interface DiscordStaticEmbedField {
  inline: boolean
  name: string
  value: string
}

export interface DiscordStaticEmbed {
  author?: { name: string }
  color?: number
  description?: string
  fields?: DiscordStaticEmbedField[]
  footer?: { text: string }
  timestamp?: string
  title?: string
}

export interface EmbedLayoutCounts {
  embeds: number
  fields: number
}

export interface EmbedPresentationReview {
  aggregateCharacters: number
  contentCharacters: number
  counts: EmbedLayoutCounts
  mentionedUserIds: string[]
  notificationUserIds: string[]
  presentation: NormalizedEmbedPresentation
  preview: string
  requestBytes: number
  suppressedUserMentionIds: string[]
  warnings: string[]
}

const EMBED_KEYS = new Set([
  "authorName",
  "color",
  "description",
  "fields",
  "footerText",
  "timestamp",
  "title",
])
const FIELD_KEYS = new Set(["inline", "name", "value"])
const DISCORD_EMBED_KEYS = new Set([
  "author",
  "color",
  "description",
  "fields",
  "flags",
  "footer",
  "timestamp",
  "title",
  "type",
])
const DISCORD_AUTHOR_KEYS = new Set(["name"])
const DISCORD_FOOTER_KEYS = new Set(["text"])
const HTTP_URL_PATTERN = /https?:\/\//iu
const TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const ISO_8601_TIMESTAMP_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/
const MESSAGE_CONTENT_CHARACTERS = 2_000

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key)).sort()
  if (unexpected.length > 0) {
    throw new RangeError(`${path} contains unsupported fields: ${unexpected.join(", ")}`)
  }
}

function unicodeLength(value: string): number {
  return [...value].length
}

function assertValidUnicode(value: string, path: string): void {
  if (TEXT_CONTROL_PATTERN.test(value)) {
    throw new RangeError(`${path} contains unsupported control characters`)
  }
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError(`${path} contains invalid Unicode`, { cause: error })
  }
}

function normalizedText(value: unknown, maximum: number, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RangeError(`${path} must be non-blank text`)
  }
  const normalized = value.trim()
  assertValidUnicode(normalized, path)
  if (unicodeLength(normalized) > maximum || normalized.length > maximum) {
    throw new RangeError(`${path} must not exceed ${maximum} characters`)
  }
  return normalized
}

function optionalText(
  value: unknown,
  maximum: number,
  path: string,
): string | null {
  return value === undefined ? null : normalizedText(value, maximum, path)
}

export function isExplicitOffsetIso8601Timestamp(
  value: unknown,
): value is string {
  if (typeof value !== "string") return false
  const match = ISO_8601_TIMESTAMP_PATTERN.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1
    && month <= 12
    && day >= 1
    && day <= (monthDays[month - 1] ?? 0)
    && hour <= 23
    && minute <= 59
    && second <= 59
    && !Number.isNaN(Date.parse(value))
}

function normalizedTimestamp(value: unknown, path: string): string | null {
  if (value === undefined) return null
  if (!isExplicitOffsetIso8601Timestamp(value)) {
    throw new RangeError(`${path} must be an ISO 8601 timestamp with an explicit offset`)
  }
  return new Date(value).toISOString()
}

function normalizedField(value: unknown, path: string): NormalizedEmbedField {
  const field = record(value, path)
  assertKeys(field, FIELD_KEYS, path)
  if (field.inline !== undefined && typeof field.inline !== "boolean") {
    throw new RangeError(`${path}.inline must be a boolean`)
  }
  return {
    inline: field.inline ?? false,
    name: normalizedText(
      field.name,
      EMBED_LAYOUT_LIMITS.fieldNameCharacters,
      `${path}.name`,
    ),
    value: normalizedText(
      field.value,
      EMBED_LAYOUT_LIMITS.fieldValueCharacters,
      `${path}.value`,
    ),
  }
}

function normalizedFields(value: unknown, path: string): NormalizedEmbedField[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new RangeError(`${path} must be an array`)
  }
  if (value.length > EMBED_LAYOUT_LIMITS.fields) {
    throw new RangeError(
      `${path} must not exceed ${EMBED_LAYOUT_LIMITS.fields} fields`,
    )
  }
  return value.map((field, index) => normalizedField(field, `${path}[${index}]`))
}

function normalizedEmbed(value: unknown, path: string): NormalizedEmbed {
  const embed = record(value, path)
  assertKeys(embed, EMBED_KEYS, path)
  if (
    embed.color !== undefined
    && (
      !Number.isInteger(embed.color)
      || (embed.color as number) < 0
      || (embed.color as number) > 0xFF_FF_FF
    )
  ) {
    throw new RangeError(`${path}.color must be an integer from 0 through 16777215`)
  }
  const normalized: NormalizedEmbed = {
    authorName: optionalText(
      embed.authorName,
      EMBED_LAYOUT_LIMITS.authorNameCharacters,
      `${path}.authorName`,
    ),
    color: (embed.color as number | undefined) ?? null,
    description: optionalText(
      embed.description,
      EMBED_LAYOUT_LIMITS.descriptionCharacters,
      `${path}.description`,
    ),
    fields: normalizedFields(embed.fields, `${path}.fields`),
    footerText: optionalText(
      embed.footerText,
      EMBED_LAYOUT_LIMITS.footerTextCharacters,
      `${path}.footerText`,
    ),
    timestamp: normalizedTimestamp(embed.timestamp, `${path}.timestamp`),
    title: optionalText(
      embed.title,
      EMBED_LAYOUT_LIMITS.titleCharacters,
      `${path}.title`,
    ),
  }
  if (
    normalized.authorName === null
    && normalized.color === null
    && normalized.description === null
    && normalized.fields.length === 0
    && normalized.footerText === null
    && normalized.timestamp === null
    && normalized.title === null
  ) {
    throw new RangeError(`${path} must contain at least one static presentation field`)
  }
  return normalized
}

export function embedLayoutAggregateCharacters(
  layout: NormalizedEmbedLayout,
): number {
  let total = 0
  for (const embed of layout) {
    if (embed.title !== null) total += unicodeLength(embed.title)
    if (embed.description !== null) total += unicodeLength(embed.description)
    if (embed.footerText !== null) total += unicodeLength(embed.footerText)
    if (embed.authorName !== null) total += unicodeLength(embed.authorName)
    for (const field of embed.fields) {
      total += unicodeLength(field.name) + unicodeLength(field.value)
    }
  }
  return total
}

function embedLayoutAggregateCodeUnits(layout: NormalizedEmbedLayout): number {
  let total = 0
  for (const embed of layout) {
    if (embed.title !== null) total += embed.title.length
    if (embed.description !== null) total += embed.description.length
    if (embed.footerText !== null) total += embed.footerText.length
    if (embed.authorName !== null) total += embed.authorName.length
    for (const field of embed.fields) {
      total += field.name.length + field.value.length
    }
  }
  return total
}

export function normalizeEmbedLayout(input: unknown): NormalizedEmbedLayout {
  if (!Array.isArray(input) || input.length < 1) {
    throw new RangeError("Discord embed layout must contain at least one embed")
  }
  if (input.length > EMBED_LAYOUT_LIMITS.embeds) {
    throw new RangeError(
      `Discord embed layout must not exceed ${EMBED_LAYOUT_LIMITS.embeds} embeds`,
    )
  }
  const layout = input.map((embed, index) => normalizedEmbed(embed, `embeds[${index}]`))
  const aggregateCharacters = embedLayoutAggregateCharacters(layout)
  if (
    aggregateCharacters > EMBED_LAYOUT_LIMITS.aggregateCharacters
    || embedLayoutAggregateCodeUnits(layout) > EMBED_LAYOUT_LIMITS.aggregateCharacters
  ) {
    throw new RangeError(
      `Discord embed text must not exceed ${EMBED_LAYOUT_LIMITS.aggregateCharacters} characters in total`,
    )
  }
  const requestBytes = new TextEncoder().encode(
    JSON.stringify(compileEmbedLayoutUnchecked(layout)),
  ).byteLength
  if (requestBytes > EMBED_LAYOUT_LIMITS.requestBytes) {
    throw new RangeError(
      `Discord embed layout must not exceed ${EMBED_LAYOUT_LIMITS.requestBytes} serialized bytes`,
    )
  }
  return layout
}

function normalizeContent(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const content = normalizedText(value, MESSAGE_CONTENT_CHARACTERS, "content")
  if (HTTP_URL_PATTERN.test(content)) {
    throw new RangeError(
      "Discord embed-message plain content cannot contain HTTP URLs because Discord may auto-embed them",
    )
  }
  return content
}

export function normalizeEmbedPresentation(input: unknown): NormalizedEmbedPresentation {
  const presentation = record(input, "presentation")
  assertKeys(presentation, new Set(["content", "embeds"]), "presentation")
  const normalized = {
    content: normalizeContent(presentation.content),
    embeds: normalizeEmbedLayout(presentation.embeds),
  }
  if (embedPresentationRequestBytes(normalized) > EMBED_LAYOUT_LIMITS.requestBytes) {
    throw new RangeError(
      `Discord embed presentation must not exceed ${EMBED_LAYOUT_LIMITS.requestBytes} serialized bytes`,
    )
  }
  return normalized
}

function normalizedEmbedLayoutInput(
  layout: NormalizedEmbedLayout,
): EmbedLayoutInput[] {
  return layout.map((embed) => ({
    ...(embed.authorName === null ? {} : { authorName: embed.authorName }),
    ...(embed.color === null ? {} : { color: embed.color }),
    ...(embed.description === null ? {} : { description: embed.description }),
    ...(embed.fields.length === 0
      ? {}
      : { fields: embed.fields.map((field) => ({ ...field })) }),
    ...(embed.footerText === null ? {} : { footerText: embed.footerText }),
    ...(embed.timestamp === null ? {} : { timestamp: embed.timestamp }),
    ...(embed.title === null ? {} : { title: embed.title }),
  }))
}

function assertNormalizedEmbedPresentation(
  input: NormalizedEmbedPresentation,
): void {
  const normalized = normalizeEmbedPresentation({
    ...(input.content === null ? {} : { content: input.content }),
    embeds: normalizedEmbedLayoutInput(input.embeds),
  })
  if (stableString(input) !== stableString(normalized)) {
    throw new RangeError("Normalized Discord embed presentation is not canonical")
  }
}

function compileEmbedLayoutUnchecked(
  layout: NormalizedEmbedLayout,
): DiscordStaticEmbed[] {
  return layout.map((embed) => ({
    ...(embed.authorName === null ? {} : { author: { name: embed.authorName } }),
    ...(embed.color === null ? {} : { color: embed.color }),
    ...(embed.description === null ? {} : { description: embed.description }),
    ...(embed.fields.length === 0
      ? {}
      : { fields: embed.fields.map((field) => ({ ...field })) }),
    ...(embed.footerText === null ? {} : { footer: { text: embed.footerText } }),
    ...(embed.timestamp === null ? {} : { timestamp: embed.timestamp }),
    ...(embed.title === null ? {} : { title: embed.title }),
  }))
}

function embedPresentationRequestBytes(
  presentation: NormalizedEmbedPresentation,
): number {
  return new TextEncoder().encode(JSON.stringify({
    ...(presentation.content === null ? {} : { content: presentation.content }),
    embeds: compileEmbedLayoutUnchecked(presentation.embeds),
  })).byteLength
}

export function compileEmbedLayout(input: unknown): DiscordStaticEmbed[] {
  return compileEmbedLayoutUnchecked(normalizeEmbedLayout(input))
}

export function compileNormalizedEmbedLayout(
  input: NormalizedEmbedLayout,
): DiscordStaticEmbed[] {
  const presentation = { content: null, embeds: input }
  assertNormalizedEmbedPresentation(presentation)
  return compileEmbedLayoutUnchecked(input)
}

export function assertCompiledEmbedLayout(
  input: unknown,
): asserts input is DiscordStaticEmbed[] {
  if (!Array.isArray(input)) {
    throw new RangeError("Compiled Discord embed layout must be an array")
  }
  const parsed = parseDiscordEmbedLayout(input, false)
  const canonical = compileEmbedLayoutUnchecked(parsed)
  if (stableString(input) !== stableString(canonical)) {
    throw new RangeError("Compiled Discord embed layout is not canonical")
  }
}

function responseText(
  value: unknown,
  maximum: number,
  path: string,
): string | null {
  return value === undefined ? null : normalizedText(value, maximum, path)
}

function parseDiscordField(value: unknown, path: string): EmbedFieldInput {
  const field = record(value, path)
  assertKeys(field, FIELD_KEYS, path)
  if (field.inline !== undefined && typeof field.inline !== "boolean") {
    throw new RangeError(`${path}.inline must be a boolean`)
  }
  return {
    ...(field.inline === undefined ? {} : { inline: field.inline }),
    name: field.name as string,
    value: field.value as string,
  }
}

function parseDiscordEmbed(
  value: unknown,
  path: string,
  response: boolean,
): EmbedLayoutInput {
  const embed = record(value, path)
  assertKeys(embed, response ? DISCORD_EMBED_KEYS : new Set([
    "author",
    "color",
    "description",
    "fields",
    "footer",
    "timestamp",
    "title",
  ]), path)
  if (response && embed.type !== undefined && embed.type !== "rich") {
    throw new RangeError(`${path}.type must be rich`)
  }
  if (response && embed.flags !== undefined && embed.flags !== 0) {
    throw new RangeError(`${path}.flags must be zero when present`)
  }
  let authorName: string | undefined
  if (embed.author !== undefined) {
    const author = record(embed.author, `${path}.author`)
    assertKeys(author, DISCORD_AUTHOR_KEYS, `${path}.author`)
    authorName = author.name as string
  }
  let footerText: string | undefined
  if (embed.footer !== undefined) {
    const footer = record(embed.footer, `${path}.footer`)
    assertKeys(footer, DISCORD_FOOTER_KEYS, `${path}.footer`)
    footerText = footer.text as string
  }
  if (embed.fields !== undefined && !Array.isArray(embed.fields)) {
    throw new RangeError(`${path}.fields must be an array`)
  }
  return {
    ...(authorName === undefined ? {} : { authorName }),
    ...(embed.color === undefined ? {} : { color: embed.color as number }),
    ...(embed.description === undefined
      ? {}
      : { description: responseText(
          embed.description,
          EMBED_LAYOUT_LIMITS.descriptionCharacters,
          `${path}.description`,
        ) as string }),
    ...(embed.fields === undefined
      ? {}
      : { fields: embed.fields.map((field, index) => (
          parseDiscordField(field, `${path}.fields[${index}]`)
        )) }),
    ...(footerText === undefined ? {} : { footerText }),
    ...(embed.timestamp === undefined ? {} : { timestamp: embed.timestamp as string }),
    ...(embed.title === undefined ? {} : { title: embed.title as string }),
  }
}

function parseDiscordEmbedLayout(
  input: unknown,
  response: boolean,
): NormalizedEmbedLayout {
  if (!Array.isArray(input)) {
    throw new RangeError("Discord embed response must be an array")
  }
  return normalizeEmbedLayout(input.map((embed, index) => (
    parseDiscordEmbed(embed, `embeds[${index}]`, response)
  )))
}

export function parseDiscordEmbedResponse(input: unknown): NormalizedEmbedLayout {
  return parseDiscordEmbedLayout(input, true)
}

export function parseDiscordEmbedPresentation(
  content: unknown,
  embeds: unknown,
): NormalizedEmbedPresentation {
  if (typeof content !== "string") {
    throw new RangeError("Discord embed-message content must be a string")
  }
  return {
    content: content === "" ? null : normalizeContent(content),
    embeds: parseDiscordEmbedResponse(embeds),
  }
}

export function embedLayoutsEqual(
  left: NormalizedEmbedLayout,
  right: NormalizedEmbedLayout,
): boolean {
  return stableString(left) === stableString(right)
}

export function embedPresentationsEqual(
  left: NormalizedEmbedPresentation,
  right: NormalizedEmbedPresentation,
): boolean {
  return stableString(left) === stableString(right)
}

export function embedLayoutCounts(layout: NormalizedEmbedLayout): EmbedLayoutCounts {
  return {
    embeds: layout.length,
    fields: layout.reduce((total, embed) => total + embed.fields.length, 0),
  }
}

export function embedLayoutText(layout: NormalizedEmbedLayout): string {
  const values: string[] = []
  for (const embed of layout) {
    if (embed.authorName !== null) values.push(embed.authorName)
    if (embed.title !== null) values.push(embed.title)
    if (embed.description !== null) values.push(embed.description)
    for (const field of embed.fields) values.push(field.name, field.value)
    if (embed.footerText !== null) values.push(embed.footerText)
  }
  return values.join("\n")
}

function colorText(color: number | null): string {
  return color === null
    ? "none"
    : `#${color.toString(16).padStart(6, "0").toUpperCase()}`
}

function previewLines(presentation: NormalizedEmbedPresentation): string[] {
  const lines: string[] = []
  lines.push(`Content: ${presentation.content === null ? "none" : JSON.stringify(presentation.content)}`)
  presentation.embeds.forEach((embed, index) => {
    const path = String(index + 1)
    lines.push(
      `[${path}] Embed: color=${colorText(embed.color)} timestamp=${embed.timestamp ?? "none"}`,
    )
    if (embed.authorName !== null) {
      lines.push(`  Author: ${JSON.stringify(embed.authorName)}`)
    }
    if (embed.title !== null) lines.push(`  Title: ${JSON.stringify(embed.title)}`)
    if (embed.description !== null) {
      lines.push(`  Description: ${JSON.stringify(embed.description)}`)
    }
    embed.fields.forEach((field, fieldIndex) => {
      lines.push(
        `  Field ${fieldIndex + 1}: inline=${field.inline} name=${JSON.stringify(field.name)} value=${JSON.stringify(field.value)}`,
      )
    })
    if (embed.footerText !== null) {
      lines.push(`  Footer: ${JSON.stringify(embed.footerText)}`)
    }
  })
  return lines
}

export function reviewEmbedPresentation(
  input: unknown,
  requestedNotificationUserIds: readonly string[] | undefined,
): EmbedPresentationReview {
  const presentation = normalizeEmbedPresentation(input)
  const content = presentation.content ?? ""
  const layoutText = embedLayoutText(presentation.embeds)
  const mentionedUserIds = [...new Set([
    ...discordMentionedUserIds(content),
    ...discordMentionedUserIds(layoutText),
  ])].sort()
  const notificationUserIds = canonicalDiscordNotificationUserIds(
    content,
    requestedNotificationUserIds,
  )
  const notificationSet = new Set(notificationUserIds)
  const suppressedUserMentionIds = mentionedUserIds.filter(
    (userId) => !notificationSet.has(userId),
  )
  const requestBytes = embedPresentationRequestBytes(presentation)
  return {
    aggregateCharacters: embedLayoutAggregateCharacters(presentation.embeds),
    contentCharacters: presentation.content === null
      ? 0
      : unicodeLength(presentation.content),
    counts: embedLayoutCounts(presentation.embeds),
    mentionedUserIds,
    notificationUserIds,
    presentation,
    preview: previewLines(presentation).join("\n"),
    requestBytes,
    suppressedUserMentionIds,
    warnings: [
      "Role and everyone mentions are always suppressed",
      "Embed URLs, media, icons, attachments, providers, videos, and arbitrary types are unsupported",
      "HTTP URLs are unsupported in plain content so Discord cannot add an unreviewed link embed",
      "Discord Markdown and client rendering are presentation behavior, not trusted instructions",
      ...(suppressedUserMentionIds.length > 0
        ? ["Visible user mentions omitted from notifyUserIds are rendered without notification"]
        : []),
    ],
  }
}

export function reviewNormalizedEmbedPresentation(
  input: NormalizedEmbedPresentation,
  requestedNotificationUserIds: readonly string[] | undefined,
): EmbedPresentationReview {
  assertNormalizedEmbedPresentation(input)
  return reviewEmbedPresentation({
    ...(input.content === null ? {} : { content: input.content }),
    embeds: normalizedEmbedLayoutInput(input.embeds),
  }, requestedNotificationUserIds)
}
