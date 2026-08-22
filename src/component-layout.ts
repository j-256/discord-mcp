import { stableString } from "./normalize.js"
import {
  canonicalDiscordNotificationUserIds,
  discordMentionedUserIds,
} from "./message-safety.js"

export const COMPONENT_LAYOUT_KINDS = [
  "container",
  "separator",
  "text",
] as const

export const COMPONENT_SEPARATOR_SPACING = [
  "large",
  "small",
] as const

export const COMPONENT_LAYOUT_LIMITS = Object.freeze({
  componentId: 0xFF_FF_FF_FF,
  components: 40,
  serializedBytes: 16_384,
  textCharacters: 4_000,
})

export const DISCORD_COMPONENT_TYPES = Object.freeze({
  container: 17,
  separator: 14,
  textDisplay: 10,
})

export const DISCORD_SEPARATOR_SPACING = Object.freeze({
  large: 2,
  small: 1,
})

export type ComponentLayoutKind = typeof COMPONENT_LAYOUT_KINDS[number]
export type ComponentSeparatorSpacing = typeof COMPONENT_SEPARATOR_SPACING[number]

export interface ComponentTextInput {
  content: string
  kind: "text"
}

export interface ComponentSeparatorInput {
  divider?: boolean
  kind: "separator"
  spacing?: ComponentSeparatorSpacing
}

export interface ComponentContainerInput {
  accentColor?: number
  components: readonly (ComponentTextInput | ComponentSeparatorInput)[]
  kind: "container"
  spoiler?: boolean
}

export type ComponentLayoutInput =
  | ComponentContainerInput
  | ComponentSeparatorInput
  | ComponentTextInput

export interface NormalizedComponentText {
  content: string
  kind: "text"
}

export interface NormalizedComponentSeparator {
  divider: boolean
  kind: "separator"
  spacing: ComponentSeparatorSpacing
}

export interface NormalizedComponentContainer {
  accentColor: number | null
  components: (NormalizedComponentText | NormalizedComponentSeparator)[]
  kind: "container"
  spoiler: boolean
}

export type NormalizedComponent =
  | NormalizedComponentContainer
  | NormalizedComponentSeparator
  | NormalizedComponentText

export type NormalizedComponentLayout = NormalizedComponent[]

export interface DiscordTextDisplayComponent {
  content: string
  type: 10
}

export interface DiscordSeparatorComponent {
  divider: boolean
  spacing: 1 | 2
  type: 14
}

export interface DiscordContainerComponent {
  accent_color?: number
  components: (DiscordTextDisplayComponent | DiscordSeparatorComponent)[]
  spoiler: boolean
  type: 17
}

export type DiscordStaticComponent =
  | DiscordContainerComponent
  | DiscordSeparatorComponent
  | DiscordTextDisplayComponent

export interface ComponentLayoutCounts {
  containers: number
  separators: number
  textDisplays: number
  topLevel: number
  total: number
}

export interface ComponentLayoutReview {
  counts: ComponentLayoutCounts
  layout: NormalizedComponentLayout
  mentionedUserIds: string[]
  notificationUserIds: string[]
  preview: string
  suppressedUserMentionIds: string[]
  textCharacters: number
  warnings: string[]
}

interface LayoutAccumulator {
  containers: number
  separators: number
  textCharacters: number
  textDisplays: number
  total: number
}

const TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const TEXT_KEYS = new Set(["content", "kind"])
const SEPARATOR_KEYS = new Set(["divider", "kind", "spacing"])
const CONTAINER_KEYS = new Set(["accentColor", "components", "kind", "spoiler"])
const DISCORD_TEXT_KEYS = new Set(["content", "id", "type"])
const DISCORD_SEPARATOR_KEYS = new Set(["divider", "id", "spacing", "type"])
const DISCORD_CONTAINER_KEYS = new Set([
  "accent_color",
  "components",
  "id",
  "spoiler",
  "type",
])
const DISCORD_TEXT_REQUEST_KEYS = new Set(["content", "type"])
const DISCORD_SEPARATOR_REQUEST_KEYS = new Set(["divider", "spacing", "type"])
const DISCORD_CONTAINER_REQUEST_KEYS = new Set([
  "accent_color",
  "components",
  "spoiler",
  "type",
])

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

function assertText(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RangeError(`${path} must be non-blank text`)
  }
  const length = unicodeLength(value)
  if (length > COMPONENT_LAYOUT_LIMITS.textCharacters) {
    throw new RangeError(
      `${path} must not exceed ${COMPONENT_LAYOUT_LIMITS.textCharacters} Unicode characters`,
    )
  }
  if (TEXT_CONTROL_PATTERN.test(value)) {
    throw new RangeError(`${path} contains unsupported control characters`)
  }
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError(`${path} contains invalid Unicode`, { cause: error })
  }
  return value
}

function addNode(accumulator: LayoutAccumulator, path: string): void {
  accumulator.total += 1
  if (accumulator.total > COMPONENT_LAYOUT_LIMITS.components) {
    throw new RangeError(
      `${path} exceeds the ${COMPONENT_LAYOUT_LIMITS.components}-component message limit`,
    )
  }
}

function normalizeText(
  value: Record<string, unknown>,
  path: string,
  accumulator: LayoutAccumulator,
): NormalizedComponentText {
  assertKeys(value, TEXT_KEYS, path)
  const content = assertText(value.content, `${path}.content`)
  accumulator.textDisplays += 1
  accumulator.textCharacters += unicodeLength(content)
  if (accumulator.textCharacters > COMPONENT_LAYOUT_LIMITS.textCharacters) {
    throw new RangeError(
      `Component text must not exceed ${COMPONENT_LAYOUT_LIMITS.textCharacters} Unicode characters in total`,
    )
  }
  return { content, kind: "text" }
}

function normalizeSeparator(
  value: Record<string, unknown>,
  path: string,
  accumulator: LayoutAccumulator,
): NormalizedComponentSeparator {
  assertKeys(value, SEPARATOR_KEYS, path)
  if (value.divider !== undefined && typeof value.divider !== "boolean") {
    throw new RangeError(`${path}.divider must be a boolean`)
  }
  if (
    value.spacing !== undefined
    && !COMPONENT_SEPARATOR_SPACING.includes(value.spacing as ComponentSeparatorSpacing)
  ) {
    throw new RangeError(`${path}.spacing must be small or large`)
  }
  accumulator.separators += 1
  return {
    divider: value.divider ?? true,
    kind: "separator",
    spacing: (value.spacing ?? "small") as ComponentSeparatorSpacing,
  }
}

function normalizeContainer(
  value: Record<string, unknown>,
  path: string,
  accumulator: LayoutAccumulator,
): NormalizedComponentContainer {
  assertKeys(value, CONTAINER_KEYS, path)
  if (
    value.accentColor !== undefined
    && (
      !Number.isInteger(value.accentColor)
      || (value.accentColor as number) < 0
      || (value.accentColor as number) > 0xFF_FF_FF
    )
  ) {
    throw new RangeError(`${path}.accentColor must be an integer from 0 through 16777215`)
  }
  if (value.spoiler !== undefined && typeof value.spoiler !== "boolean") {
    throw new RangeError(`${path}.spoiler must be a boolean`)
  }
  if (!Array.isArray(value.components) || value.components.length < 1) {
    throw new RangeError(`${path}.components must contain at least one text or separator`)
  }
  accumulator.containers += 1
  const components = value.components.map((child, index) => {
    const childPath = `${path}.components[${index}]`
    const childRecord = record(child, childPath)
    addNode(accumulator, childPath)
    if (childRecord.kind === "text") {
      return normalizeText(childRecord, childPath, accumulator)
    }
    if (childRecord.kind === "separator") {
      return normalizeSeparator(childRecord, childPath, accumulator)
    }
    if (childRecord.kind === "container") {
      throw new RangeError(`${childPath} cannot nest a container`)
    }
    throw new RangeError(`${childPath}.kind must be text or separator`)
  })
  return {
    accentColor: (value.accentColor as number | undefined) ?? null,
    components,
    kind: "container",
    spoiler: value.spoiler ?? false,
  }
}

function normalizeNode(
  value: unknown,
  path: string,
  accumulator: LayoutAccumulator,
): NormalizedComponent {
  const node = record(value, path)
  addNode(accumulator, path)
  if (node.kind === "text") return normalizeText(node, path, accumulator)
  if (node.kind === "separator") return normalizeSeparator(node, path, accumulator)
  if (node.kind === "container") return normalizeContainer(node, path, accumulator)
  throw new RangeError(`${path}.kind must be container, separator, or text`)
}

export function normalizeComponentLayout(input: unknown): NormalizedComponentLayout {
  if (
    !Array.isArray(input)
    || input.length < 1
    || input.length > COMPONENT_LAYOUT_LIMITS.components
  ) {
    throw new RangeError(
      `Component layout must contain 1-${COMPONENT_LAYOUT_LIMITS.components} top-level components`,
    )
  }
  const accumulator: LayoutAccumulator = {
    containers: 0,
    separators: 0,
    textCharacters: 0,
    textDisplays: 0,
    total: 0,
  }
  const layout = input.map((value, index) => (
    normalizeNode(value, `components[${index}]`, accumulator)
  ))
  if (accumulator.textDisplays < 1) {
    throw new RangeError("Component layout must contain at least one Text Display")
  }
  const serializedBytes = Buffer.byteLength(stableString(layout), "utf8")
  if (serializedBytes > COMPONENT_LAYOUT_LIMITS.serializedBytes) {
    throw new RangeError(
      `Canonical component layout must not exceed ${COMPONENT_LAYOUT_LIMITS.serializedBytes} UTF-8 bytes`,
    )
  }
  return layout
}

function compileNode(component: NormalizedComponent): DiscordStaticComponent {
  if (component.kind === "text") {
    return {
      content: component.content,
      type: DISCORD_COMPONENT_TYPES.textDisplay,
    }
  }
  if (component.kind === "separator") {
    return {
      divider: component.divider,
      spacing: DISCORD_SEPARATOR_SPACING[component.spacing],
      type: DISCORD_COMPONENT_TYPES.separator,
    }
  }
  return {
    ...(component.accentColor === null
      ? {}
      : { accent_color: component.accentColor }),
    components: component.components.map(compileNode) as (
      DiscordTextDisplayComponent | DiscordSeparatorComponent
    )[],
    spoiler: component.spoiler,
    type: DISCORD_COMPONENT_TYPES.container,
  }
}

export function compileComponentLayout(
  layout: NormalizedComponentLayout,
): DiscordStaticComponent[] {
  return layout.map(compileNode)
}

function parseCompiledNode(
  input: unknown,
  path: string,
  child: boolean,
): ComponentLayoutInput {
  const value = record(input, path)
  if (value.type === DISCORD_COMPONENT_TYPES.textDisplay) {
    assertKeys(value, DISCORD_TEXT_REQUEST_KEYS, path)
    return { content: value.content as string, kind: "text" }
  }
  if (value.type === DISCORD_COMPONENT_TYPES.separator) {
    assertKeys(value, DISCORD_SEPARATOR_REQUEST_KEYS, path)
    if (value.divider === undefined || value.spacing === undefined) {
      throw new RangeError(`${path} must include explicit separator defaults`)
    }
    if (value.spacing !== 1 && value.spacing !== 2) {
      throw new RangeError(`${path}.spacing must be Discord separator spacing 1 or 2`)
    }
    return {
      divider: value.divider as boolean,
      kind: "separator",
      spacing: value.spacing === 2 ? "large" : "small",
    }
  }
  if (value.type === DISCORD_COMPONENT_TYPES.container) {
    if (child) throw new RangeError(`${path} cannot contain a nested Discord container`)
    assertKeys(value, DISCORD_CONTAINER_REQUEST_KEYS, path)
    if (!Array.isArray(value.components) || value.spoiler === undefined) {
      throw new RangeError(`${path} must include components and an explicit spoiler default`)
    }
    return {
      ...(value.accent_color === undefined
        ? {}
        : { accentColor: value.accent_color as number }),
      components: value.components.map((entry, index) => (
        parseCompiledNode(entry, `${path}.components[${index}]`, true)
      )) as (ComponentTextInput | ComponentSeparatorInput)[],
      kind: "container",
      spoiler: value.spoiler as boolean,
    }
  }
  throw new RangeError(`${path}.type is not a supported static Discord component`)
}

export function assertCompiledComponentLayout(
  input: unknown,
): asserts input is DiscordStaticComponent[] {
  if (!Array.isArray(input)) {
    throw new RangeError("Compiled Discord component layout must be an array")
  }
  const parsed = input.map((entry, index) => (
    parseCompiledNode(entry, `components[${index}]`, false)
  ))
  const canonical = compileComponentLayout(normalizeComponentLayout(parsed))
  if (stableString(input) !== stableString(canonical)) {
    throw new RangeError("Compiled Discord component layout is not canonical")
  }
}

function componentId(
  value: Record<string, unknown>,
  path: string,
  ids: Set<number>,
): void {
  if (
    !Number.isInteger(value.id)
    || (value.id as number) < 1
    || (value.id as number) > COMPONENT_LAYOUT_LIMITS.componentId
  ) {
    throw new RangeError(`${path}.id must be a positive 32-bit integer assigned by Discord`)
  }
  const id = value.id as number
  if (ids.has(id)) {
    throw new RangeError(`${path}.id duplicates Discord component ID ${id}`)
  }
  ids.add(id)
}

function parseDiscordNode(
  input: unknown,
  path: string,
  ids: Set<number>,
  child: boolean,
): ComponentLayoutInput {
  const value = record(input, path)
  componentId(value, path, ids)
  if (value.type === DISCORD_COMPONENT_TYPES.textDisplay) {
    assertKeys(value, DISCORD_TEXT_KEYS, path)
    return { content: value.content as string, kind: "text" }
  }
  if (value.type === DISCORD_COMPONENT_TYPES.separator) {
    assertKeys(value, DISCORD_SEPARATOR_KEYS, path)
    if (value.spacing !== undefined && value.spacing !== 1 && value.spacing !== 2) {
      throw new RangeError(`${path}.spacing must be Discord separator spacing 1 or 2`)
    }
    return {
      ...(value.divider === undefined ? {} : { divider: value.divider as boolean }),
      kind: "separator",
      ...(value.spacing === undefined
        ? {}
        : { spacing: value.spacing === 2 ? "large" as const : "small" as const }),
    }
  }
  if (value.type === DISCORD_COMPONENT_TYPES.container) {
    if (child) throw new RangeError(`${path} cannot contain a nested Discord container`)
    assertKeys(value, DISCORD_CONTAINER_KEYS, path)
    if (!Array.isArray(value.components)) {
      throw new RangeError(`${path}.components must be an array`)
    }
    return {
      ...(value.accent_color === undefined || value.accent_color === null
        ? {}
        : { accentColor: value.accent_color as number }),
      components: value.components.map((entry, index) => (
        parseDiscordNode(entry, `${path}.components[${index}]`, ids, true)
      )) as (ComponentTextInput | ComponentSeparatorInput)[],
      kind: "container",
      ...(value.spoiler === undefined ? {} : { spoiler: value.spoiler as boolean }),
    }
  }
  throw new RangeError(`${path}.type is not a supported static Discord component`)
}

export function parseDiscordComponentLayout(input: unknown): NormalizedComponentLayout {
  if (!Array.isArray(input)) {
    throw new RangeError("Discord component response must be an array")
  }
  const ids = new Set<number>()
  const parsed = input.map((entry, index) => (
    parseDiscordNode(entry, `components[${index}]`, ids, false)
  ))
  return normalizeComponentLayout(parsed)
}

export function componentLayoutsEqual(
  left: NormalizedComponentLayout,
  right: NormalizedComponentLayout,
): boolean {
  return stableString(left) === stableString(right)
}

export function componentLayoutText(layout: NormalizedComponentLayout): string {
  const values: string[] = []
  for (const component of layout) {
    if (component.kind === "text") values.push(component.content)
    if (component.kind === "container") {
      for (const child of component.components) {
        if (child.kind === "text") values.push(child.content)
      }
    }
  }
  return values.join("\n")
}

export function componentLayoutTextCharacters(
  layout: NormalizedComponentLayout,
): number {
  let total = 0
  for (const component of layout) {
    if (component.kind === "text") total += unicodeLength(component.content)
    if (component.kind === "container") {
      for (const child of component.components) {
        if (child.kind === "text") total += unicodeLength(child.content)
      }
    }
  }
  return total
}

export function componentLayoutCounts(
  layout: NormalizedComponentLayout,
): ComponentLayoutCounts {
  const counts: ComponentLayoutCounts = {
    containers: 0,
    separators: 0,
    textDisplays: 0,
    topLevel: layout.length,
    total: 0,
  }
  const count = (component: NormalizedComponent) => {
    counts.total += 1
    if (component.kind === "text") counts.textDisplays += 1
    if (component.kind === "separator") counts.separators += 1
    if (component.kind === "container") {
      counts.containers += 1
      component.components.forEach(count)
    }
  }
  layout.forEach(count)
  return counts
}

function previewLines(layout: NormalizedComponentLayout): string[] {
  const lines: string[] = []
  layout.forEach((component, index) => {
    const path = String(index + 1)
    if (component.kind === "text") {
      lines.push(`[${path}] Text Display: ${JSON.stringify(component.content)}`)
      return
    }
    if (component.kind === "separator") {
      lines.push(
        `[${path}] Separator: divider=${component.divider} spacing=${component.spacing}`,
      )
      return
    }
    const accent = component.accentColor === null
      ? "none"
      : `#${component.accentColor.toString(16).padStart(6, "0").toUpperCase()}`
    lines.push(
      `[${path}] Container: accent=${accent} spoiler=${component.spoiler}`,
    )
    component.components.forEach((child, childIndex) => {
      const childPath = `${path}.${childIndex + 1}`
      if (child.kind === "text") {
        lines.push(`  [${childPath}] Text Display: ${JSON.stringify(child.content)}`)
      } else {
        lines.push(
          `  [${childPath}] Separator: divider=${child.divider} spacing=${child.spacing}`,
        )
      }
    })
  })
  return lines
}

export function reviewComponentLayout(
  input: unknown,
  requestedNotificationUserIds: readonly string[] | undefined,
): ComponentLayoutReview {
  const layout = normalizeComponentLayout(input)
  const text = componentLayoutText(layout)
  const mentionedUserIds = discordMentionedUserIds(text)
  const notificationUserIds = canonicalDiscordNotificationUserIds(
    text,
    requestedNotificationUserIds,
  )
  const notificationSet = new Set(notificationUserIds)
  const suppressedUserMentionIds = mentionedUserIds.filter(
    (userId) => !notificationSet.has(userId),
  )
  return {
    counts: componentLayoutCounts(layout),
    layout,
    mentionedUserIds,
    notificationUserIds,
    preview: previewLines(layout).join("\n"),
    suppressedUserMentionIds,
    textCharacters: componentLayoutTextCharacters(layout),
    warnings: [
      "Components V2 is irreversible for a created message",
      "Role and everyone mentions are always suppressed",
      "This static layout registers no button, select, modal, or callback authority",
      ...(suppressedUserMentionIds.length > 0
        ? ["Visible user mentions omitted from notifyUserIds are rendered without notification"]
        : []),
    ],
  }
}
