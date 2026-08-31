import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import {
  CONNECTOR_LIMITS,
  SCHEMA_VERSION,
} from "./constants.js"
import { z } from "./lazy-z.js"

const DOCUMENTATION_SOURCES = Object.freeze([
  "README.md",
  "docs/comparison.md",
  "docs/getting-started.md",
  "docs/limitations.md",
  "docs/migration.md",
  "docs/reference.md",
  "docs/releasing.md",
  "docs/safety-usability.md",
  "PRIVACY.md",
  "SECURITY.md",
  "SUPPORT.md",
] as const)

declare const __GUILDCONTROL_DOCUMENTATION_ROOT__: string | undefined

const SEARCH_STOP_WORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "could",
  "discord",
  "do",
  "does",
  "for",
  "from",
  "guildcontrol",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "that",
  "the",
  "this",
  "to",
  "tool",
  "using",
  "was",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "you",
  "your",
])

interface DocumentationSection {
  markdown: string
  normalizedMarkdown: string
  normalizedTitle: string
  searchTokens: ReadonlySet<string>
  source: string
  title: string
  titleTokens: ReadonlySet<string>
}

interface RankedDocumentationSection {
  score: number
  section: DocumentationSection
}

export interface GuildControlDocumentationMatch {
  excerpt: string
  source: string
  title: string
}

export interface GuildControlDocumentationSearchResult {
  authorityGranted: false
  credentialsRequired: false
  discordContacted: false
  matches: GuildControlDocumentationMatch[]
  schemaVersion: number
  sourcesSearched: number
  status: "ok"
  totalMatches: number
  warnings: readonly string[]
}

export const guildControlDocumentationSearchInputSchema = z.strictObject({
  limit: z.number()
    .int()
    .min(1)
    .max(CONNECTOR_LIMITS.documentationSearchMatches)
    .default(3)
    .describe("Maximum documentation sections to return"),
  query: z.string()
    .min(1)
    .max(CONNECTOR_LIMITS.documentationSearchQueryCharacters)
    .refine((value) => value.trim().length > 0, "query must not be blank")
    .describe("Exact error text or a policy, configuration, setup, or recovery question"),
})

export type GuildControlDocumentationSearchInput = z.infer<
  typeof guildControlDocumentationSearchInputSchema
>

let documentationIndexPromise: Promise<readonly DocumentationSection[]> | undefined

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function meaningfulTokens(value: string): string[] {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => (
      token.length > 1
      && !SEARCH_STOP_WORDS.has(token)
      && !/^\d{7,}$/.test(token)
    ))
}

function searchTermVariants(term: string): string[] {
  const variants = new Set([term])
  if (term.endsWith("ies") && term.length > 4) {
    variants.add(`${term.slice(0, -3)}y`)
  } else if (term.endsWith("s") && term.length > 3 && !term.endsWith("ss")) {
    variants.add(term.slice(0, -1))
  }
  if (term.endsWith("ed") && term.length > 4) {
    variants.add(term.slice(0, -2))
  }
  if (term.endsWith("ing") && term.length > 5) {
    variants.add(term.slice(0, -3))
  }
  return [...variants]
}

function searchableTokens(value: string): ReadonlySet<string> {
  return new Set(meaningfulTokens(value).flatMap(searchTermVariants))
}

function plainHeading(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim()
}

function headingAnchor(value: string): string {
  return normalizeSearchText(value).replaceAll(" ", "-")
}

function parseMarkdownSections(
  source: string,
  markdown: string,
): DocumentationSection[] {
  const headings = [...markdown.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)]
  const ancestry: string[] = []
  return headings.map((heading, index) => {
    const level = heading[1]?.length ?? 1
    const title = plainHeading(heading[2] ?? source)
    ancestry.length = level - 1
    ancestry[level - 1] = title
    const titlePath = ancestry.filter(Boolean).join(" > ")
    const start = heading.index ?? 0
    const end = headings[index + 1]?.index ?? markdown.length
    const sectionMarkdown = markdown.slice(start, end).trim()
    const normalizedMarkdown = meaningfulTokens(sectionMarkdown).join(" ")
    return {
      markdown: sectionMarkdown,
      normalizedMarkdown,
      normalizedTitle: meaningfulTokens(titlePath).join(" "),
      searchTokens: searchableTokens(`${titlePath}\n${sectionMarkdown}`),
      source: `${source}#${headingAnchor(title)}`,
      title: titlePath,
      titleTokens: searchableTokens(titlePath),
    }
  })
}

async function buildDocumentationIndex(): Promise<readonly DocumentationSection[]> {
  const documents = await Promise.all(DOCUMENTATION_SOURCES.map(async (source) => ({
    markdown: await readFile(documentationSourceUrl(source), "utf8"),
    source,
  })))
  return documents.flatMap(({ markdown, source }) => (
    parseMarkdownSections(source, markdown)
  ))
}

function documentationSourceUrl(source: typeof DOCUMENTATION_SOURCES[number]): URL {
  if (typeof __GUILDCONTROL_DOCUMENTATION_ROOT__ === "string") {
    const entrypoint = process.argv[1]
    if (!entrypoint) throw new Error("GuildControl documentation root is unavailable")
    return pathToFileURL(resolve(
      dirname(entrypoint),
      __GUILDCONTROL_DOCUMENTATION_ROOT__,
      source,
    ))
  }
  return new URL(`../${source}`, import.meta.url)
}

function documentationIndex(): Promise<readonly DocumentationSection[]> {
  documentationIndexPromise ??= buildDocumentationIndex()
  return documentationIndexPromise
}

function scoreSection(
  section: DocumentationSection,
  queryTerms: readonly string[],
): number | null {
  const uniqueTerms = [...new Set(queryTerms)]
  let matchedTerms = 0
  let score = 0
  for (const term of uniqueTerms) {
    const variants = searchTermVariants(term)
    const titleMatch = variants.some((variant) => section.titleTokens.has(variant))
    const bodyMatch = variants.some((variant) => section.searchTokens.has(variant))
    if (!titleMatch && !bodyMatch) continue
    matchedTerms += 1
    score += titleMatch ? 120 : 20
  }
  const requiredTerms = uniqueTerms.length === 1
    ? 1
    : Math.ceil(uniqueTerms.length / 2)
  if (matchedTerms < requiredTerms) return null
  const phrase = uniqueTerms.join(" ")
  if (phrase && section.normalizedTitle.includes(phrase)) score += 500
  if (phrase && section.normalizedMarkdown.includes(phrase)) score += 250
  if (matchedTerms === uniqueTerms.length) score += 100
  return score
}

function boundedExcerpt(
  section: DocumentationSection,
  queryTerms: readonly string[],
): string {
  const limit = CONNECTOR_LIMITS.documentationSearchExcerptCharacters
  if (section.markdown.length <= limit) return section.markdown
  const normalizedMarkdown = normalizeSearchText(section.markdown)
  const firstMatch = queryTerms
    .map((term) => normalizedMarkdown.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? 0
  const approximateRatio = normalizedMarkdown.length === 0
    ? 0
    : firstMatch / normalizedMarkdown.length
  const approximateIndex = Math.floor(section.markdown.length * approximateRatio)
  let start = Math.max(0, approximateIndex - Math.floor(limit / 3))
  if (start < 300) start = 0
  if (start > 0) {
    const nextParagraph = section.markdown.indexOf("\n\n", start)
    if (nextParagraph >= 0 && nextParagraph - start < 400) {
      start = nextParagraph + 2
    }
  }
  const prefix = start > 0 ? "...\n\n" : ""
  const available = limit - prefix.length - 5
  let excerpt = section.markdown.slice(start, start + available).trimEnd()
  const lastParagraph = excerpt.lastIndexOf("\n\n")
  if (lastParagraph > Math.floor(available * 0.7)) {
    excerpt = excerpt.slice(0, lastParagraph).trimEnd()
  }
  return `${prefix}${excerpt}\n\n...`
}

export async function searchGuildControlDocumentation(
  input: GuildControlDocumentationSearchInput,
): Promise<GuildControlDocumentationSearchResult> {
  const queryTerms = meaningfulTokens(input.query)
  const sections = await documentationIndex()
  const ranked: RankedDocumentationSection[] = []
  if (queryTerms.length > 0) {
    for (const section of sections) {
      const score = scoreSection(section, queryTerms)
      if (score !== null) ranked.push({ score, section })
    }
    ranked.sort((left, right) => (
      right.score - left.score
      || left.section.source.localeCompare(right.section.source)
    ))
  }
  return {
    authorityGranted: false,
    credentialsRequired: false,
    discordContacted: false,
    matches: ranked.slice(0, input.limit).map(({ section }) => ({
      excerpt: boundedExcerpt(section, queryTerms),
      source: section.source,
      title: section.title,
    })),
    schemaVersion: SCHEMA_VERSION,
    sourcesSearched: DOCUMENTATION_SOURCES.length,
    status: "ok",
    totalMatches: ranked.length,
    warnings: [
      "Documentation is guidance, not authority; current configuration and runtime checks remain authoritative",
    ],
  }
}
