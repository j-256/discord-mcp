import { stableString } from "./normalize.js"
import {
  canonicalDiscordNotificationUserIds,
  discordMentionedUserIds,
} from "./message-safety.js"
import {
  COMPONENT_LINK_LIMITS,
  componentLinkOrigin,
  normalizeComponentLinkUrl,
} from "./component-link.js"
import {
  createRequestButtonCustomId,
  createRequestButtonRoute,
  DISCORD_REQUEST_BUTTON_STYLES,
  isManagedRequestButtonCustomId,
  parseRequestButtonCustomId,
  REQUEST_BUTTON_LIMITS,
  REQUEST_BUTTON_STYLES,
  requestButtonLayoutDigest,
  type RequestButtonRouteBinding,
  type RequestButtonScope,
  type RequestButtonStyle,
  verifyRequestButtonCustomId,
} from "./request-button.js"

export const COMPONENT_LAYOUT_KINDS = [
  "container",
  "link-row",
  "request-row",
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
  actionRow: 1,
  button: 2,
  container: 17,
  separator: 14,
  textDisplay: 10,
})

export const DISCORD_BUTTON_STYLES = Object.freeze({
  link: 5,
  ...DISCORD_REQUEST_BUTTON_STYLES,
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

export interface ComponentLinkButtonInput {
  label: string
  url: string
}

export interface ComponentLinkRowInput {
  buttons: readonly ComponentLinkButtonInput[]
  kind: "link-row"
}

export interface ComponentRequestButtonInput {
  label: string
  style?: RequestButtonStyle
}

export interface ComponentRequestRowInput {
  buttons: readonly ComponentRequestButtonInput[]
  kind: "request-row"
}

export interface ComponentContainerInput {
  accentColor?: number
  components: readonly (
    | ComponentLinkRowInput
    | ComponentRequestRowInput
    | ComponentTextInput
    | ComponentSeparatorInput
  )[]
  kind: "container"
  spoiler?: boolean
}

export type ComponentLayoutInput =
  | ComponentContainerInput
  | ComponentLinkRowInput
  | ComponentRequestRowInput
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

export interface NormalizedComponentLinkButton {
  label: string
  url: string
}

export interface NormalizedComponentLinkRow {
  buttons: NormalizedComponentLinkButton[]
  kind: "link-row"
}

export interface NormalizedComponentRequestButton {
  label: string
  style: RequestButtonStyle
}

export interface NormalizedComponentRequestRow {
  buttons: NormalizedComponentRequestButton[]
  kind: "request-row"
}

export interface NormalizedComponentContainer {
  accentColor: number | null
  components: (
    | NormalizedComponentLinkRow
    | NormalizedComponentRequestRow
    | NormalizedComponentText
    | NormalizedComponentSeparator
  )[]
  kind: "container"
  spoiler: boolean
}

export type NormalizedComponent =
  | NormalizedComponentContainer
  | NormalizedComponentLinkRow
  | NormalizedComponentRequestRow
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

export interface DiscordLinkButtonComponent {
  label: string
  style: 5
  type: 2
  url: string
}

export interface DiscordRequestButtonComponent {
  custom_id: string
  label: string
  style: 1 | 2 | 3 | 4
  type: 2
}

export interface DiscordActionRowComponent {
  components: DiscordLinkButtonComponent[] | DiscordRequestButtonComponent[]
  type: 1
}

export interface DiscordContainerComponent {
  accent_color?: number
  components: (
    DiscordActionRowComponent | DiscordTextDisplayComponent | DiscordSeparatorComponent
  )[]
  spoiler: boolean
  type: 17
}

export type DiscordStaticComponent =
  | DiscordActionRowComponent
  | DiscordContainerComponent
  | DiscordSeparatorComponent
  | DiscordTextDisplayComponent

export interface ComponentLayoutCounts {
  actionRows: number
  containers: number
  linkButtons: number
  requestButtons: number
  separators: number
  textDisplays: number
  topLevel: number
  total: number
}

export interface ComponentLayoutReview {
  counts: ComponentLayoutCounts
  layout: NormalizedComponentLayout
  linkOrigins: string[]
  linkUrls: string[]
  mentionedUserIds: string[]
  notificationUserIds: string[]
  preview: string
  suppressedUserMentionIds: string[]
  textCharacters: number
  warnings: string[]
}

export interface ComponentLayoutRequestButtonBinding {
  binding: RequestButtonRouteBinding
  key: Uint8Array
}

export interface ComponentLayoutRequestButtonVerification {
  key: Uint8Array
  operationKeyHash?: string
  scope: RequestButtonScope
}

export interface ManagedRequestButton {
  customId: string
  index: number
  label: string
  route: string
  style: RequestButtonStyle
}

export interface ParsedManagedComponentLayout {
  layout: NormalizedComponentLayout
  requestButtons: ManagedRequestButton[]
  route: string | null
}

interface LayoutAccumulator {
  actionRows: number
  containers: number
  linkButtons: number
  requestButtons: number
  separators: number
  textCharacters: number
  textDisplays: number
  total: number
}

const TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const TEXT_KEYS = new Set(["content", "kind"])
const SEPARATOR_KEYS = new Set(["divider", "kind", "spacing"])
const LINK_BUTTON_KEYS = new Set(["label", "url"])
const LINK_ROW_KEYS = new Set(["buttons", "kind"])
const REQUEST_BUTTON_KEYS = new Set(["label", "style"])
const REQUEST_ROW_KEYS = new Set(["buttons", "kind"])
const CONTAINER_KEYS = new Set(["accentColor", "components", "kind", "spoiler"])
const DISCORD_TEXT_KEYS = new Set(["content", "id", "type"])
const DISCORD_SEPARATOR_KEYS = new Set(["divider", "id", "spacing", "type"])
const DISCORD_LINK_BUTTON_KEYS = new Set([
  "disabled",
  "id",
  "label",
  "style",
  "type",
  "url",
])
const DISCORD_REQUEST_BUTTON_KEYS = new Set([
  "custom_id",
  "disabled",
  "id",
  "label",
  "style",
  "type",
])
const DISCORD_ACTION_ROW_KEYS = new Set(["components", "id", "type"])
const DISCORD_CONTAINER_KEYS = new Set([
  "accent_color",
  "components",
  "id",
  "spoiler",
  "type",
])
const DISCORD_TEXT_REQUEST_KEYS = new Set(["content", "type"])
const DISCORD_SEPARATOR_REQUEST_KEYS = new Set(["divider", "spacing", "type"])
const DISCORD_LINK_BUTTON_REQUEST_KEYS = new Set(["label", "style", "type", "url"])
const DISCORD_REQUEST_BUTTON_REQUEST_KEYS = new Set([
  "custom_id",
  "label",
  "style",
  "type",
])
const DISCORD_ACTION_ROW_REQUEST_KEYS = new Set(["components", "type"])
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

function assertLinkLabel(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RangeError(`${path} must be non-blank text`)
  }
  if (unicodeLength(value) > COMPONENT_LINK_LIMITS.labelCharacters) {
    throw new RangeError(
      `${path} must not exceed ${COMPONENT_LINK_LIMITS.labelCharacters} Unicode characters`,
    )
  }
  if (TEXT_CONTROL_PATTERN.test(value) || /[\n\r\u2028\u2029]/u.test(value)) {
    throw new RangeError(`${path} must be single-line text without control characters`)
  }
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError(`${path} contains invalid Unicode`, { cause: error })
  }
  return value
}

function assertRequestButtonLabel(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RangeError(`${path} must be non-blank text`)
  }
  if ([...value].length > REQUEST_BUTTON_LIMITS.labelCharacters) {
    throw new RangeError(
      `${path} must not exceed ${REQUEST_BUTTON_LIMITS.labelCharacters} Unicode characters`,
    )
  }
  if (TEXT_CONTROL_PATTERN.test(value) || /[\n\r\u2028\u2029]/u.test(value)) {
    throw new RangeError(`${path} must be single-line text without control characters`)
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

function normalizeLinkRow(
  value: Record<string, unknown>,
  path: string,
  accumulator: LayoutAccumulator,
): NormalizedComponentLinkRow {
  assertKeys(value, LINK_ROW_KEYS, path)
  if (
    !Array.isArray(value.buttons)
    || value.buttons.length < 1
    || value.buttons.length > COMPONENT_LINK_LIMITS.buttonsPerRow
  ) {
    throw new RangeError(
      `${path}.buttons must contain 1-${COMPONENT_LINK_LIMITS.buttonsPerRow} link buttons`,
    )
  }
  accumulator.actionRows += 1
  const buttons = value.buttons.map((button, index) => {
    const buttonPath = `${path}.buttons[${index}]`
    const buttonRecord = record(button, buttonPath)
    assertKeys(buttonRecord, LINK_BUTTON_KEYS, buttonPath)
    addNode(accumulator, buttonPath)
    accumulator.linkButtons += 1
    return {
      label: assertLinkLabel(buttonRecord.label, `${buttonPath}.label`),
      url: normalizeComponentLinkUrl(buttonRecord.url, `${buttonPath}.url`),
    }
  })
  return { buttons, kind: "link-row" }
}

function normalizeRequestRow(
  value: Record<string, unknown>,
  path: string,
  accumulator: LayoutAccumulator,
): NormalizedComponentRequestRow {
  assertKeys(value, REQUEST_ROW_KEYS, path)
  if (
    !Array.isArray(value.buttons)
    || value.buttons.length < 1
    || value.buttons.length > REQUEST_BUTTON_LIMITS.buttonsPerRow
  ) {
    throw new RangeError(
      `${path}.buttons must contain 1-${REQUEST_BUTTON_LIMITS.buttonsPerRow} request buttons`,
    )
  }
  accumulator.actionRows += 1
  const buttons = value.buttons.map((button, index) => {
    const buttonPath = `${path}.buttons[${index}]`
    const buttonRecord = record(button, buttonPath)
    assertKeys(buttonRecord, REQUEST_BUTTON_KEYS, buttonPath)
    if (
      buttonRecord.style !== undefined
      && !REQUEST_BUTTON_STYLES.includes(buttonRecord.style as RequestButtonStyle)
    ) {
      throw new RangeError(
        `${buttonPath}.style must be primary, secondary, success, or danger`,
      )
    }
    addNode(accumulator, buttonPath)
    accumulator.requestButtons += 1
    return {
      label: assertRequestButtonLabel(buttonRecord.label, `${buttonPath}.label`),
      style: (buttonRecord.style ?? "secondary") as RequestButtonStyle,
    }
  })
  return { buttons, kind: "request-row" }
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
    throw new RangeError(
      `${path}.components must contain at least one text, separator, link row, or request row`,
    )
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
    if (childRecord.kind === "link-row") {
      return normalizeLinkRow(childRecord, childPath, accumulator)
    }
    if (childRecord.kind === "request-row") {
      return normalizeRequestRow(childRecord, childPath, accumulator)
    }
    if (childRecord.kind === "container") {
      throw new RangeError(`${childPath} cannot nest a container`)
    }
    throw new RangeError(
      `${childPath}.kind must be link-row, request-row, separator, or text`,
    )
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
  if (node.kind === "link-row") return normalizeLinkRow(node, path, accumulator)
  if (node.kind === "request-row") return normalizeRequestRow(node, path, accumulator)
  if (node.kind === "container") return normalizeContainer(node, path, accumulator)
  throw new RangeError(
    `${path}.kind must be container, link-row, request-row, separator, or text`,
  )
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
    actionRows: 0,
    containers: 0,
    linkButtons: 0,
    requestButtons: 0,
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

interface ComponentCompilationState {
  buttonIndex: number
  layoutDigest: string
  requestButtons: ComponentLayoutRequestButtonBinding | undefined
  route: string | undefined
}

function compileNode(
  component: NormalizedComponent,
  state: ComponentCompilationState,
): DiscordStaticComponent {
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
  if (component.kind === "link-row") {
    return {
      components: component.buttons.map((button) => ({
        label: button.label,
        style: DISCORD_BUTTON_STYLES.link,
        type: DISCORD_COMPONENT_TYPES.button,
        url: button.url,
      })),
      type: DISCORD_COMPONENT_TYPES.actionRow,
    }
  }
  if (component.kind === "request-row") {
    if (!state.requestButtons || !state.route) {
      throw new RangeError(
        "Managed Discord request buttons require an explicit authenticated binding",
      )
    }
    const requestButtons = state.requestButtons
    const route = state.route
    return {
      components: component.buttons.map((button) => {
        const index = state.buttonIndex
        state.buttonIndex += 1
        return {
          custom_id: createRequestButtonCustomId(
            requestButtons.key,
            requestButtons.binding,
            state.layoutDigest,
            route,
            { index, label: button.label, style: button.style },
          ),
          label: button.label,
          style: DISCORD_REQUEST_BUTTON_STYLES[button.style] as 1 | 2 | 3 | 4,
          type: DISCORD_COMPONENT_TYPES.button,
        }
      }),
      type: DISCORD_COMPONENT_TYPES.actionRow,
    }
  }
  return {
    ...(component.accentColor === null
      ? {}
      : { accent_color: component.accentColor }),
    components: component.components.map((child) => (
      compileNode(child, state)
    )) as DiscordContainerComponent["components"],
    spoiler: component.spoiler,
    type: DISCORD_COMPONENT_TYPES.container,
  }
}

function parseCompiledLinkButton(
  input: unknown,
  path: string,
): ComponentLinkButtonInput {
  const value = record(input, path)
  assertKeys(value, DISCORD_LINK_BUTTON_REQUEST_KEYS, path)
  if (
    value.type !== DISCORD_COMPONENT_TYPES.button
    || value.style !== DISCORD_BUTTON_STYLES.link
  ) {
    throw new RangeError(`${path} must be a Discord Link-style Button`)
  }
  return {
    label: value.label as string,
    url: value.url as string,
  }
}

function parseCompiledRequestButton(
  input: unknown,
  path: string,
): ComponentRequestButtonInput & { customId: string } {
  const value = record(input, path)
  assertKeys(value, DISCORD_REQUEST_BUTTON_REQUEST_KEYS, path)
  const style = Object.entries(DISCORD_REQUEST_BUTTON_STYLES)
    .find(([, numeric]) => numeric === value.style)?.[0] as RequestButtonStyle | undefined
  if (
    value.type !== DISCORD_COMPONENT_TYPES.button
    || !style
    || typeof value.custom_id !== "string"
    || !parseRequestButtonCustomId(value.custom_id)
  ) {
    throw new RangeError(`${path} must be a managed Discord request Button`)
  }
  return {
    customId: value.custom_id,
    label: value.label as string,
    style,
  }
}

export function compileComponentLayout(
  layout: NormalizedComponentLayout,
  requestButtons?: ComponentLayoutRequestButtonBinding,
): DiscordStaticComponent[] {
  const layoutDigest = requestButtonLayoutDigest(layout)
  const route = requestButtons
    ? createRequestButtonRoute(
        requestButtons.key,
        requestButtons.binding,
        layoutDigest,
      )
    : undefined
  const state: ComponentCompilationState = {
    buttonIndex: 0,
    layoutDigest,
    requestButtons,
    route,
  }
  return layout.map((component) => compileNode(component, state))
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
  if (value.type === DISCORD_COMPONENT_TYPES.actionRow) {
    assertKeys(value, DISCORD_ACTION_ROW_REQUEST_KEYS, path)
    if (!Array.isArray(value.components)) {
      throw new RangeError(`${path}.components must be an array`)
    }
    const managed = value.components.some((entry) => (
      isManagedRequestButtonCustomId(record(entry, `${path}.components[]`).custom_id)
    ))
    if (managed) {
      return {
        buttons: value.components.map((entry, index) => {
          const { customId: _customId, ...button } = parseCompiledRequestButton(
            entry,
            `${path}.components[${index}]`,
          )
          return button
        }),
        kind: "request-row",
      }
    }
    return {
      buttons: value.components.map((entry, index) => (
        parseCompiledLinkButton(entry, `${path}.components[${index}]`)
      )),
      kind: "link-row",
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
      )) as (
        | ComponentLinkRowInput
        | ComponentRequestRowInput
        | ComponentTextInput
        | ComponentSeparatorInput
      )[],
      kind: "container",
      spoiler: value.spoiler as boolean,
    }
  }
  throw new RangeError(`${path}.type is not a supported Discord component`)
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
  const normalized = normalizeComponentLayout(parsed)
  if (componentLayoutHasRequestButtons(normalized)) {
    const customIds: string[] = []
    const collect = (entry: unknown): void => {
      const value = record(entry, "compiled component")
      if (value.type === DISCORD_COMPONENT_TYPES.button && value.style !== 5) {
        if (typeof value.custom_id !== "string") {
          throw new RangeError("Compiled Discord request Button lacks a custom ID")
        }
        customIds.push(value.custom_id)
      }
      if (Array.isArray(value.components)) value.components.forEach(collect)
    }
    input.forEach(collect)
    const identities = customIds.map(parseRequestButtonCustomId)
    if (
      identities.some((identity) => !identity)
      || new Set(customIds).size !== customIds.length
      || new Set(identities.map((identity) => identity?.route)).size !== 1
      || identities.some((identity, index) => identity?.index !== index)
    ) {
      throw new RangeError("Compiled Discord request Buttons have invalid managed identities")
    }
    return
  }
  const canonical = compileComponentLayout(normalized)
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

function parseDiscordLinkButton(
  input: unknown,
  path: string,
  ids: Set<number>,
): ComponentLinkButtonInput {
  const value = record(input, path)
  componentId(value, path, ids)
  assertKeys(value, DISCORD_LINK_BUTTON_KEYS, path)
  if (
    value.type !== DISCORD_COMPONENT_TYPES.button
    || value.style !== DISCORD_BUTTON_STYLES.link
  ) {
    throw new RangeError(`${path} must be a Discord Link-style Button`)
  }
  if (value.disabled !== undefined && value.disabled !== false) {
    throw new RangeError(`${path}.disabled must be false when Discord includes it`)
  }
  return {
    label: value.label as string,
    url: value.url as string,
  }
}

interface RawManagedRequestButton {
  customId: string
  label: string
  style: RequestButtonStyle
}

interface DiscordLayoutParseState {
  ids: Set<number>
  requestButtons: RawManagedRequestButton[]
}

function parseDiscordRequestButton(
  input: unknown,
  path: string,
  state: DiscordLayoutParseState,
): ComponentRequestButtonInput {
  const value = record(input, path)
  componentId(value, path, state.ids)
  assertKeys(value, DISCORD_REQUEST_BUTTON_KEYS, path)
  const style = Object.entries(DISCORD_REQUEST_BUTTON_STYLES)
    .find(([, numeric]) => numeric === value.style)?.[0] as RequestButtonStyle | undefined
  if (
    value.type !== DISCORD_COMPONENT_TYPES.button
    || !style
    || typeof value.custom_id !== "string"
    || !parseRequestButtonCustomId(value.custom_id)
  ) {
    throw new RangeError(`${path} must be an authenticated Discord request Button`)
  }
  if (value.disabled !== undefined && value.disabled !== false) {
    throw new RangeError(`${path}.disabled must be false when Discord includes it`)
  }
  const label = value.label as string
  state.requestButtons.push({
    customId: value.custom_id,
    label,
    style,
  })
  return { label, style }
}

function parseDiscordNode(
  input: unknown,
  path: string,
  state: DiscordLayoutParseState,
  child: boolean,
): ComponentLayoutInput {
  const value = record(input, path)
  componentId(value, path, state.ids)
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
  if (value.type === DISCORD_COMPONENT_TYPES.actionRow) {
    assertKeys(value, DISCORD_ACTION_ROW_KEYS, path)
    if (!Array.isArray(value.components)) {
      throw new RangeError(`${path}.components must be an array`)
    }
    const requestRow = value.components.some((entry, index) => {
      const button = record(entry, `${path}.components[${index}]`)
      return [1, 2, 3, 4].includes(button.style as number)
        || button.style !== DISCORD_BUTTON_STYLES.link
          && button.custom_id !== undefined
    })
    return requestRow
      ? {
          buttons: value.components.map((entry, index) => (
            parseDiscordRequestButton(
              entry,
              `${path}.components[${index}]`,
              state,
            )
          )),
          kind: "request-row",
        }
      : {
          buttons: value.components.map((entry, index) => (
            parseDiscordLinkButton(entry, `${path}.components[${index}]`, state.ids)
          )),
          kind: "link-row",
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
        parseDiscordNode(entry, `${path}.components[${index}]`, state, true)
      )) as (
        | ComponentLinkRowInput
        | ComponentRequestRowInput
        | ComponentTextInput
        | ComponentSeparatorInput
      )[],
      kind: "container",
      ...(value.spoiler === undefined ? {} : { spoiler: value.spoiler as boolean }),
    }
  }
  throw new RangeError(`${path}.type is not a supported Discord component`)
}

export function parseDiscordManagedComponentLayout(
  input: unknown,
  requestButtonVerification?: ComponentLayoutRequestButtonVerification,
): ParsedManagedComponentLayout {
  if (!Array.isArray(input)) {
    throw new RangeError("Discord component response must be an array")
  }
  const state: DiscordLayoutParseState = {
    ids: new Set<number>(),
    requestButtons: [],
  }
  const parsed = input.map((entry, index) => (
    parseDiscordNode(entry, `components[${index}]`, state, false)
  ))
  const layout = normalizeComponentLayout(parsed)
  if (state.requestButtons.length === 0) {
    return { layout, requestButtons: [], route: null }
  }
  if (!requestButtonVerification) {
    throw new RangeError(
      "Discord response contains request buttons without an authenticated verification binding",
    )
  }
  const layoutDigest = requestButtonLayoutDigest(layout)
  let route: string | null = null
  const requestButtons = state.requestButtons.map((button, index): ManagedRequestButton => {
    const identity = verifyRequestButtonCustomId(
      requestButtonVerification.key,
      requestButtonVerification.scope,
      layoutDigest,
      button.customId,
      { index, label: button.label, style: button.style },
    )
    if (!identity || (route !== null && route !== identity.route)) {
      throw new RangeError("Discord response contains an invalid managed request Button")
    }
    route ??= identity.route
    return {
      customId: button.customId,
      index,
      label: button.label,
      route: identity.route,
      style: button.style,
    }
  })
  if (requestButtonVerification.operationKeyHash !== undefined) {
    const expectedRoute = createRequestButtonRoute(
      requestButtonVerification.key,
      {
        ...requestButtonVerification.scope,
        operationKeyHash: requestButtonVerification.operationKeyHash,
      },
      layoutDigest,
    )
    if (route !== expectedRoute) {
      throw new RangeError(
        "Discord response request Buttons do not match the reviewed operation",
      )
    }
  }
  return { layout, requestButtons, route }
}

export function parseDiscordComponentLayout(
  input: unknown,
  requestButtonVerification?: ComponentLayoutRequestButtonVerification,
): NormalizedComponentLayout {
  return parseDiscordManagedComponentLayout(input, requestButtonVerification).layout
}

export function componentLayoutsEqual(
  left: NormalizedComponentLayout,
  right: NormalizedComponentLayout,
): boolean {
  return stableString(left) === stableString(right)
}

export function componentLayoutHasRequestButtons(
  layout: NormalizedComponentLayout,
): boolean {
  return layout.some((component) => (
    component.kind === "request-row"
    || component.kind === "container"
      && component.components.some((child) => child.kind === "request-row")
  ))
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
    actionRows: 0,
    containers: 0,
    linkButtons: 0,
    requestButtons: 0,
    separators: 0,
    textDisplays: 0,
    topLevel: layout.length,
    total: 0,
  }
  const count = (component: NormalizedComponent) => {
    counts.total += 1
    if (component.kind === "text") counts.textDisplays += 1
    if (component.kind === "separator") counts.separators += 1
    if (component.kind === "link-row") {
      counts.actionRows += 1
      counts.linkButtons += component.buttons.length
      counts.total += component.buttons.length
    }
    if (component.kind === "request-row") {
      counts.actionRows += 1
      counts.requestButtons += component.buttons.length
      counts.total += component.buttons.length
    }
    if (component.kind === "container") {
      counts.containers += 1
      component.components.forEach(count)
    }
  }
  layout.forEach(count)
  return counts
}

function componentLayoutLinks(layout: NormalizedComponentLayout): {
  origins: string[]
  urls: string[]
} {
  const urls: string[] = []
  const collect = (component: NormalizedComponent) => {
    if (component.kind === "link-row") {
      urls.push(...component.buttons.map((button) => button.url))
    }
    if (component.kind === "container") component.components.forEach(collect)
  }
  layout.forEach(collect)
  return {
    origins: [...new Set(urls.map(componentLinkOrigin))].sort(),
    urls,
  }
}

function previewLines(layout: NormalizedComponentLayout): string[] {
  const lines: string[] = []
  layout.forEach((component, index) => {
    const path = String(index + 1)
    if (component.kind === "text") {
      lines.push(`[${path}] Text Display: ${JSON.stringify(component.content)}`)
      return
    }
    if (component.kind === "request-row") {
      lines.push(`[${path}] Action Row: ${component.buttons.length} request button(s)`)
      component.buttons.forEach((button, buttonIndex) => {
        const buttonPath = `${path}.${buttonIndex + 1}`
        lines.push(
          `  [${buttonPath}] Request Button (${button.style}): ${JSON.stringify(button.label)}`,
        )
      })
      return
    }
    if (component.kind === "separator") {
      lines.push(
        `[${path}] Separator: divider=${component.divider} spacing=${component.spacing}`,
      )
      return
    }
    if (component.kind === "link-row") {
      lines.push(`[${path}] Action Row: ${component.buttons.length} link button(s)`)
      component.buttons.forEach((button, buttonIndex) => {
        const buttonPath = `${path}.${buttonIndex + 1}`
        lines.push(
          `  [${buttonPath}] Link Button: ${JSON.stringify(button.label)} -> ${button.url}`,
        )
      })
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
      } else if (child.kind === "separator") {
        lines.push(
          `  [${childPath}] Separator: divider=${child.divider} spacing=${child.spacing}`,
        )
      } else if (child.kind === "link-row") {
        lines.push(`  [${childPath}] Action Row: ${child.buttons.length} link button(s)`)
        child.buttons.forEach((button, buttonIndex) => {
          const buttonPath = `${childPath}.${buttonIndex + 1}`
          lines.push(
            `    [${buttonPath}] Link Button: ${JSON.stringify(button.label)} -> ${button.url}`,
          )
        })
      } else {
        lines.push(`  [${childPath}] Action Row: ${child.buttons.length} request button(s)`)
        child.buttons.forEach((button, buttonIndex) => {
          const buttonPath = `${childPath}.${buttonIndex + 1}`
          lines.push(
            `    [${buttonPath}] Request Button (${button.style}): ${JSON.stringify(button.label)}`,
          )
        })
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
  const links = componentLayoutLinks(layout)
  const counts = componentLayoutCounts(layout)
  return {
    counts,
    layout,
    linkOrigins: links.origins,
    linkUrls: links.urls,
    mentionedUserIds,
    notificationUserIds,
    preview: previewLines(layout).join("\n"),
    suppressedUserMentionIds,
    textCharacters: componentLayoutTextCharacters(layout),
    warnings: [
      "Components V2 is irreversible for a created message",
      "Role and everyone mentions are always suppressed",
      ...(links.urls.length > 0
        ? [
            "Link buttons open external HTTPS URLs without callback authority",
            "The connector does not fetch links or verify redirects or final destinations",
          ]
        : []),
      ...(counts.requestButtons > 0
        ? [
            "Request buttons open private bounded broker requests and never execute a Discord action directly",
            "Request-button clicks require ready native Interaction ingress and exact guild, channel, and user scope",
            "Button styling, including danger, grants no write or destructive authority",
            "Managed custom IDs are authenticated; rotating the bot token invalidates existing request buttons",
            "This layout registers no select, modal, caller-defined custom ID, or arbitrary callback authority",
          ]
        : links.urls.length > 0
          ? ["This static layout registers no custom-ID button, select, modal, or callback authority"]
          : ["This static layout registers no button, select, modal, or callback authority"]),
      ...(suppressedUserMentionIds.length > 0
        ? ["Visible user mentions omitted from notifyUserIds are rendered without notification"]
        : []),
    ],
  }
}
