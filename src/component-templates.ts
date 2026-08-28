import {
  reviewComponentLayout,
  type ComponentContainerInput,
  type ComponentLayoutReview,
  type ComponentSeparatorInput,
  type ComponentTextInput,
} from "./component-layout.js"

export const COMPONENT_TEMPLATE_NAMES = [
  "announcement",
  "incident-status",
  "poll-results",
  "release-notes",
  "welcome-card",
] as const

export const COMPONENT_ANNOUNCEMENT_PRIORITIES = [
  "important",
  "information",
  "urgent",
] as const

export const COMPONENT_INCIDENT_STATUSES = [
  "identified",
  "investigating",
  "monitoring",
  "resolved",
] as const

export const COMPONENT_TEMPLATE_LIMITS = Object.freeze({
  announcementBodyCharacters: 3_000,
  headlineCharacters: 120,
  incidentImpactCharacters: 800,
  incidentNextUpdateCharacters: 240,
  incidentSummaryCharacters: 1_600,
  itemCharacters: 240,
  items: 8,
  pollOptionCharacters: 120,
  pollOptions: 10,
  pollQuestionCharacters: 240,
  pollVotes: 1_000_000_000,
  releaseNameCharacters: 120,
  summaryCharacters: 1_600,
})

export const COMPONENT_TEMPLATE_VERSION = 1

export type ComponentTemplateName = typeof COMPONENT_TEMPLATE_NAMES[number]
export type ComponentAnnouncementPriority =
  typeof COMPONENT_ANNOUNCEMENT_PRIORITIES[number]
export type ComponentIncidentStatus = typeof COMPONENT_INCIDENT_STATUSES[number]

export interface AnnouncementComponentTemplateInput {
  body: string
  headline: string
  priority: ComponentAnnouncementPriority
  template: "announcement"
}

export interface IncidentStatusComponentTemplateInput {
  impact?: string
  nextUpdate?: string
  status: ComponentIncidentStatus
  summary: string
  template: "incident-status"
  title: string
}

export interface PollResultOptionInput {
  label: string
  votes: number
}

export interface PollResultsComponentTemplateInput {
  options: readonly PollResultOptionInput[]
  question: string
  template: "poll-results"
}

export interface ReleaseNotesComponentTemplateInput {
  changes: readonly string[]
  releaseName: string
  summary: string
  template: "release-notes"
}

export interface WelcomeCardComponentTemplateInput {
  headline: string
  introduction: string
  steps: readonly string[]
  template: "welcome-card"
}

export type ComponentTemplateInput =
  | AnnouncementComponentTemplateInput
  | IncidentStatusComponentTemplateInput
  | PollResultsComponentTemplateInput
  | ReleaseNotesComponentTemplateInput
  | WelcomeCardComponentTemplateInput

export interface ComponentTemplateCompilation {
  review: ComponentLayoutReview
  template: ComponentTemplateName
  templateVersion: number
}

export interface ComponentTemplateCatalogEntry {
  accentBehavior: string
  name: ComponentTemplateName
  optionalFields: readonly string[]
  purpose: string
  requiredFields: readonly string[]
}

export const COMPONENT_TEMPLATE_CATALOG: readonly ComponentTemplateCatalogEntry[] =
  Object.freeze([
    Object.freeze({
      accentBehavior: "Derived from information, important, or urgent priority",
      name: "announcement" as const,
      optionalFields: Object.freeze([]),
      purpose: "Publish a clearly prioritized announcement",
      requiredFields: Object.freeze(["headline", "body", "priority"]),
    }),
    Object.freeze({
      accentBehavior: "Derived from investigating, identified, monitoring, or resolved status",
      name: "incident-status" as const,
      optionalFields: Object.freeze(["impact", "nextUpdate"]),
      purpose: "Publish an accessible operational incident update",
      requiredFields: Object.freeze(["title", "status", "summary"]),
    }),
    Object.freeze({
      accentBehavior: "Fixed poll accent",
      name: "poll-results" as const,
      optionalFields: Object.freeze([]),
      purpose: "Render deterministic vote totals and percentages",
      requiredFields: Object.freeze(["question", "options"]),
    }),
    Object.freeze({
      accentBehavior: "Fixed release accent",
      name: "release-notes" as const,
      optionalFields: Object.freeze([]),
      purpose: "Publish a release summary and ordered change list",
      requiredFields: Object.freeze(["releaseName", "summary", "changes"]),
    }),
    Object.freeze({
      accentBehavior: "Fixed welcome accent",
      name: "welcome-card" as const,
      optionalFields: Object.freeze([]),
      purpose: "Welcome members with a short ordered getting-started path",
      requiredFields: Object.freeze(["headline", "introduction", "steps"]),
    }),
  ])

const COMPONENT_TEMPLATE_COLORS = Object.freeze({
  announcement: Object.freeze({
    important: 0xFE_E7_5C,
    information: 0x58_65_F2,
    urgent: 0xED_42_45,
  }),
  incident: Object.freeze({
    identified: 0xFE_E7_5C,
    investigating: 0xED_42_45,
    monitoring: 0x58_65_F2,
    resolved: 0x57_F2_87,
  }),
  poll: 0xEB_45_9E,
  release: 0x58_65_F2,
  welcome: 0x57_F2_87,
})

const TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const LINE_BREAK_PATTERN = /[\n\r\u2028\u2029]/u
const ANNOUNCEMENT_KEYS = new Set(["body", "headline", "priority", "template"])
const INCIDENT_KEYS = new Set([
  "impact",
  "nextUpdate",
  "status",
  "summary",
  "template",
  "title",
])
const POLL_KEYS = new Set(["options", "question", "template"])
const POLL_OPTION_KEYS = new Set(["label", "votes"])
const RELEASE_KEYS = new Set(["changes", "releaseName", "summary", "template"])
const WELCOME_KEYS = new Set(["headline", "introduction", "steps", "template"])

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

function boundedText(
  value: unknown,
  path: string,
  maxCharacters: number,
  singleLine = false,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RangeError(`${path} must be non-blank text`)
  }
  if (unicodeLength(value) > maxCharacters) {
    throw new RangeError(`${path} must not exceed ${maxCharacters} Unicode characters`)
  }
  if (TEXT_CONTROL_PATTERN.test(value)) {
    throw new RangeError(`${path} contains unsupported control characters`)
  }
  if (singleLine && LINE_BREAK_PATTERN.test(value)) {
    throw new RangeError(`${path} must be single-line text`)
  }
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError(`${path} contains invalid Unicode`, { cause: error })
  }
  return value
}

function boundedTextList(
  value: unknown,
  path: string,
): string[] {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > COMPONENT_TEMPLATE_LIMITS.items
  ) {
    throw new RangeError(
      `${path} must contain 1-${COMPONENT_TEMPLATE_LIMITS.items} entries`,
    )
  }
  return value.map((entry, index) => boundedText(
    entry,
    `${path}[${index}]`,
    COMPONENT_TEMPLATE_LIMITS.itemCharacters,
    true,
  ))
}

function text(content: string): ComponentTextInput {
  return { content, kind: "text" }
}

function separator(): ComponentSeparatorInput {
  return { divider: true, kind: "separator", spacing: "small" }
}

function container(
  accentColor: number,
  components: readonly (ComponentTextInput | ComponentSeparatorInput)[],
): ComponentContainerInput {
  return {
    accentColor,
    components,
    kind: "container",
    spoiler: false,
  }
}

function titleCase(value: string): string {
  return value.split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function announcementLayout(value: Record<string, unknown>): ComponentContainerInput[] {
  assertKeys(value, ANNOUNCEMENT_KEYS, "template")
  if (!COMPONENT_ANNOUNCEMENT_PRIORITIES.includes(
    value.priority as ComponentAnnouncementPriority,
  )) {
    throw new RangeError("template.priority must be information, important, or urgent")
  }
  const priority = value.priority as ComponentAnnouncementPriority
  const headline = boundedText(
    value.headline,
    "template.headline",
    COMPONENT_TEMPLATE_LIMITS.headlineCharacters,
    true,
  )
  const body = boundedText(
    value.body,
    "template.body",
    COMPONENT_TEMPLATE_LIMITS.announcementBodyCharacters,
  )
  return [container(COMPONENT_TEMPLATE_COLORS.announcement[priority], [
    text(`## ${headline}\n**Priority:** ${titleCase(priority)}`),
    separator(),
    text(body),
  ])]
}

function incidentLayout(value: Record<string, unknown>): ComponentContainerInput[] {
  assertKeys(value, INCIDENT_KEYS, "template")
  if (!COMPONENT_INCIDENT_STATUSES.includes(value.status as ComponentIncidentStatus)) {
    throw new RangeError(
      "template.status must be investigating, identified, monitoring, or resolved",
    )
  }
  const status = value.status as ComponentIncidentStatus
  const title = boundedText(
    value.title,
    "template.title",
    COMPONENT_TEMPLATE_LIMITS.headlineCharacters,
    true,
  )
  const summary = boundedText(
    value.summary,
    "template.summary",
    COMPONENT_TEMPLATE_LIMITS.incidentSummaryCharacters,
  )
  const impact = value.impact === undefined
    ? null
    : boundedText(
        value.impact,
        "template.impact",
        COMPONENT_TEMPLATE_LIMITS.incidentImpactCharacters,
      )
  const nextUpdate = value.nextUpdate === undefined
    ? null
    : boundedText(
        value.nextUpdate,
        "template.nextUpdate",
        COMPONENT_TEMPLATE_LIMITS.incidentNextUpdateCharacters,
        true,
      )
  const components: (ComponentTextInput | ComponentSeparatorInput)[] = [
    text(`## ${title}\n**Status:** ${titleCase(status)}`),
    separator(),
    text(`**Summary**\n${summary}`),
  ]
  if (impact !== null) {
    components.push(separator(), text(`**Impact**\n${impact}`))
  }
  if (nextUpdate !== null) {
    components.push(separator(), text(`**Next update**\n${nextUpdate}`))
  }
  return [container(COMPONENT_TEMPLATE_COLORS.incident[status], components)]
}

function pollLayout(value: Record<string, unknown>): ComponentContainerInput[] {
  assertKeys(value, POLL_KEYS, "template")
  const question = boundedText(
    value.question,
    "template.question",
    COMPONENT_TEMPLATE_LIMITS.pollQuestionCharacters,
    true,
  )
  if (
    !Array.isArray(value.options)
    || value.options.length < 2
    || value.options.length > COMPONENT_TEMPLATE_LIMITS.pollOptions
  ) {
    throw new RangeError(
      `template.options must contain 2-${COMPONENT_TEMPLATE_LIMITS.pollOptions} options`,
    )
  }
  const options = value.options.map((entry, index) => {
    const option = record(entry, `template.options[${index}]`)
    assertKeys(option, POLL_OPTION_KEYS, `template.options[${index}]`)
    const label = boundedText(
      option.label,
      `template.options[${index}].label`,
      COMPONENT_TEMPLATE_LIMITS.pollOptionCharacters,
      true,
    )
    if (
      !Number.isInteger(option.votes)
      || (option.votes as number) < 0
      || (option.votes as number) > COMPONENT_TEMPLATE_LIMITS.pollVotes
    ) {
      throw new RangeError(
        `template.options[${index}].votes must be an integer from 0 through ${COMPONENT_TEMPLATE_LIMITS.pollVotes}`,
      )
    }
    return { label, votes: option.votes as number }
  })
  if (new Set(options.map(({ label }) => label)).size !== options.length) {
    throw new RangeError("template.options labels must be unique")
  }
  const total = options.reduce((sum, option) => sum + option.votes, 0)
  const results = options.map((option) => {
    const percentage = total === 0 ? "0.0" : ((option.votes / total) * 100).toFixed(1)
    const noun = option.votes === 1 ? "vote" : "votes"
    return `- **${option.label}:** ${option.votes} ${noun} (${percentage}%)`
  })
  const totalNoun = total === 1 ? "vote" : "votes"
  return [container(COMPONENT_TEMPLATE_COLORS.poll, [
    text(`## ${question}\n**Poll results**`),
    separator(),
    text(`${results.join("\n")}\n\n**Total:** ${total} ${totalNoun}`),
  ])]
}

function releaseLayout(value: Record<string, unknown>): ComponentContainerInput[] {
  assertKeys(value, RELEASE_KEYS, "template")
  const releaseName = boundedText(
    value.releaseName,
    "template.releaseName",
    COMPONENT_TEMPLATE_LIMITS.releaseNameCharacters,
    true,
  )
  const summary = boundedText(
    value.summary,
    "template.summary",
    COMPONENT_TEMPLATE_LIMITS.summaryCharacters,
  )
  const changes = boundedTextList(value.changes, "template.changes")
  return [container(COMPONENT_TEMPLATE_COLORS.release, [
    text(`## ${releaseName}\n**Release notes**`),
    separator(),
    text(summary),
    separator(),
    text(`**What's changed**\n${changes.map((change) => `- ${change}`).join("\n")}`),
  ])]
}

function welcomeLayout(value: Record<string, unknown>): ComponentContainerInput[] {
  assertKeys(value, WELCOME_KEYS, "template")
  const headline = boundedText(
    value.headline,
    "template.headline",
    COMPONENT_TEMPLATE_LIMITS.headlineCharacters,
    true,
  )
  const introduction = boundedText(
    value.introduction,
    "template.introduction",
    COMPONENT_TEMPLATE_LIMITS.summaryCharacters,
  )
  const steps = boundedTextList(value.steps, "template.steps")
  return [container(COMPONENT_TEMPLATE_COLORS.welcome, [
    text(`## ${headline}\n**Welcome**`),
    separator(),
    text(introduction),
    separator(),
    text(`**Get started**\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`),
  ])]
}

export function compileComponentTemplate(
  input: unknown,
  notifyUserIds?: readonly string[],
): ComponentTemplateCompilation {
  const value = record(input, "template")
  if (!COMPONENT_TEMPLATE_NAMES.includes(value.template as ComponentTemplateName)) {
    throw new RangeError(
      `template.template must be ${COMPONENT_TEMPLATE_NAMES.join(", ")}`,
    )
  }
  const template = value.template as ComponentTemplateName
  const layout = template === "announcement"
    ? announcementLayout(value)
    : template === "incident-status"
      ? incidentLayout(value)
      : template === "poll-results"
        ? pollLayout(value)
        : template === "release-notes"
          ? releaseLayout(value)
          : welcomeLayout(value)
  return {
    review: reviewComponentLayout(layout, notifyUserIds),
    template,
    templateVersion: COMPONENT_TEMPLATE_VERSION,
  }
}
