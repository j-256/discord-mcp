import {
  inspectDiscordCatalog,
  type DiscordCatalogSnapshot,
} from "./catalog.js"
import {
  CONNECTOR_NPM_PACKAGE,
  MCP_DISCOVERY_TOOL_NAME,
  SCHEMA_VERSION,
} from "./constants.js"
import { MCP_COMPLETION_VALUE_LIMIT } from "./mcp-completions.js"
import {
  MCP_PLAN_REVIEW_APP_URI,
} from "./mcp-plan-review-app.js"
import {
  resolveExclusivePrivateFile,
  writeExclusivePrivateFile,
  type ExclusivePrivateFileSystem,
} from "./exclusive-private-file.js"
import {
  MCP_TOOL_CATALOG,
  mcpToolAccessContract,
  type CanonicalMcpToolName,
  type McpToolAccessContract,
} from "./mcp-tool-catalog.js"
import {
  MCP_TOOL_RISK_CLASSES,
  type McpToolName,
} from "./observability-catalog.js"

export const CATALOG_HTML_FORMAT = "guildcontrol.catalog-html.v3"

const ANNOTATION_NAMES = [
  "readOnlyHint",
  "destructiveHint",
  "idempotentHint",
  "openWorldHint",
] as const

export interface DiscordCatalogHtmlExportOptions {
  fileSystem?: ExclusivePrivateFileSystem
  inspect?: () => Promise<DiscordCatalogSnapshot>
}

export interface DiscordCatalogHtmlExportReport {
  activityRecordsCreated: false
  bytes: number
  contractDigest: string
  credentialsRequired: false
  discordExecution: "disabled"
  file: string
  format: typeof CATALOG_HTML_FORMAT
  schemaVersion: number
  status: "ok"
  toolCount: number
}

interface ToolMetadata {
  access: McpToolAccessContract
  risk: string
  toolset: string
  workflow: string
}

interface TourToolRequirement {
  name: CanonicalMcpToolName
  stage: McpToolAccessContract["stage"]
}

interface TourToolEvidence {
  metadata: ToolMetadata
  tool: DiscordCatalogSnapshot["tools"][number]
}

const TOUR_PROMPT_NAME = "route_discord_goal"
const TOUR_TOOL_REQUIREMENTS = Object.freeze({
  activity: { name: "list_activity", stage: "local" },
  execute: { name: "execute_channel_creation", stage: "review-execute" },
  plan: { name: "plan_channel_creation", stage: "review-plan" },
  read: { name: "list_channels", stage: "live-read" },
} satisfies Record<string, TourToolRequirement>)

const CATALOG_HTML_FILE_MESSAGES = Object.freeze({
  exists: "Catalog HTML target already exists; choose a new path or move the existing file",
  failure: "Catalog HTML export could not be written",
  invalidPath: "Catalog HTML export requires a valid file path",
})

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function jsonText(value: unknown): string {
  return escapeHtml(JSON.stringify(value, null, 2))
}

function displayName(value: string): string {
  const words = value.replaceAll("_", " ").replaceAll("-", " ")
  return `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`
}

function toolMetadata(name: string): ToolMetadata {
  if (!Object.hasOwn(MCP_TOOL_RISK_CLASSES, name)) {
    throw new Error(`Catalog HTML tool ${name} lacks a risk classification`)
  }
  const risk = MCP_TOOL_RISK_CLASSES[name as McpToolName]
  const access = mcpToolAccessContract(name as McpToolName)
  if (name === MCP_DISCOVERY_TOOL_NAME) {
    return { access, risk, toolset: "connector", workflow: "standalone" }
  }
  if (!Object.hasOwn(MCP_TOOL_CATALOG, name)) {
    throw new Error(`Catalog HTML tool ${name} lacks discovery metadata`)
  }
  const metadata = MCP_TOOL_CATALOG[name as CanonicalMcpToolName] as {
    toolset: string
    workflow?: string
  }
  return {
    access,
    risk,
    toolset: metadata.toolset,
    workflow: metadata.workflow || "standalone",
  }
}

function requiredTourTool(
  tools: readonly TourToolEvidence[],
  requirement: TourToolRequirement,
): TourToolEvidence {
  const evidence = tools.find(({ tool }) => tool.name === requirement.name)
  if (!evidence) {
    throw new Error(`Catalog guided tour tool ${requirement.name} is unavailable`)
  }
  if (evidence.metadata.access.stage !== requirement.stage) {
    throw new Error(`Catalog guided tour tool ${requirement.name} has an unexpected access stage`)
  }
  return evidence
}

function requiredTourPrompt(
  snapshot: DiscordCatalogSnapshot,
): DiscordCatalogSnapshot["prompts"][number] {
  const prompt = snapshot.prompts.find(({ name }) => name === TOUR_PROMPT_NAME)
  if (!prompt) throw new Error(`Catalog guided tour prompt ${TOUR_PROMPT_NAME} is unavailable`)
  return prompt
}

function tourToolLink(
  evidence: TourToolEvidence,
  label: string,
): string {
  return `<a class="tour-contract-link" href="#tool-${escapeHtml(evidence.tool.name)}"><span>${escapeHtml(label)}</span><code>${escapeHtml(evidence.tool.name)}</code><strong>${escapeHtml(evidence.metadata.access.stage)}</strong></a>`
}

function tourPromptLink(
  prompt: DiscordCatalogSnapshot["prompts"][number],
): string {
  return `<a class="tour-contract-link" href="#prompt-${escapeHtml(prompt.name)}"><span>Negotiated prompt</span><code>${escapeHtml(prompt.name)}</code><strong>prompt</strong></a>`
}

function tourTab(
  identifier: string,
  number: number,
  label: string,
  selected = false,
): string {
  return `<button id="tour-tab-${identifier}" type="button" role="tab" aria-label="${escapeHtml(`Step ${number}: ${label}`)}" aria-controls="tour-panel-${identifier}" aria-selected="${selected ? "true" : "false"}" tabindex="${selected ? "0" : "-1"}" data-tour-tab><span>${number}</span><strong>${escapeHtml(label)}</strong></button>`
}

function tourPanel(
  identifier: string,
  number: number,
  title: string,
  summary: string,
  body: string,
  selected = false,
): string {
  return `<section id="tour-panel-${identifier}" class="tour-panel" role="tabpanel" aria-labelledby="tour-tab-${identifier}" tabindex="0"${selected ? "" : " hidden"}>
  <p class="eyebrow">Step ${number}</p>
  <h3>${escapeHtml(title)}</h3>
  <p class="tour-summary">${escapeHtml(summary)}</p>
  ${body}
</section>`
}

function guidedTourMarkup(
  snapshot: DiscordCatalogSnapshot,
  tools: readonly TourToolEvidence[],
): string {
  const routePrompt = requiredTourPrompt(snapshot)
  const read = requiredTourTool(tools, TOUR_TOOL_REQUIREMENTS.read)
  const plan = requiredTourTool(tools, TOUR_TOOL_REQUIREMENTS.plan)
  const execute = requiredTourTool(tools, TOUR_TOOL_REQUIREMENTS.execute)
  const activity = requiredTourTool(tools, TOUR_TOOL_REQUIREMENTS.activity)
  const packageSpec = `${CONNECTOR_NPM_PACKAGE}@${snapshot.report.serverVersion}`
  const tabs = [
    tourTab("inspect", 1, "Inspect", true),
    tourTab("scope", 2, "Scope"),
    tourTab("route", 3, "Route"),
    tourTab("read", 4, "Read"),
    tourTab("review", 5, "Review"),
    tourTab("execute", 6, "Execute"),
    tourTab("recover", 7, "Recover"),
  ].join("")
  const panels = [
    tourPanel(
      "inspect",
      1,
      "Inspect the shipped contract",
      "Negotiate and fingerprint the production registrations before creating a bot or granting Discord access.",
      `<pre tabindex="0"><code>${escapeHtml(`npx --yes ${packageSpec} catalog --check`)}</code></pre><div class="tour-proof-grid"><div><b>This artifact proves</b><span>Exact tools, access stages, prompts, resources, completions, review-app bytes, safety guidance, and execution blocking</span></div><div><b>It deliberately cannot prove</b><span>Bot identity, target permissions, live Discord state, or any operation outcome</span></div></div>`,
      true,
    ),
    tourPanel(
      "scope",
      2,
      "Create a narrow read-only boundary",
      "Start with one owner-managed bot, one verified guild, one strict non-secret policy, and one external token secret.",
      `<pre tabindex="0"><code>${escapeHtml(`npx --yes ${packageSpec} setup --npx --config ./guildcontrol.json --preset server-observer --guild-id YOUR_GUILD_ID`)}</code></pre><div class="tour-proof-grid"><div><b>Authority starts absent</b><span>The read-only preset cannot enable writes, Gateway access, telemetry export, activity persistence, or Message Content access</span></div><div><b>Live setup must prove</b><span>The application, bot, guild membership, selected credential source, and actual Discord permissions</span></div></div>`,
    ),
    tourPanel(
      "route",
      3,
      "Start from the operator outcome",
      "A prompt-capable client can route one goal into bounded discovery, a read, or at most a reviewed plan without granting mutation authority.",
      `${tourPromptLink(routePrompt)}<div class="tour-proof-grid"><div><b>Prompt contract</b><span>${escapeHtml(routePrompt.description || "No prompt description advertised")}</span></div><div><b>Authority boundary</b><span>Prompt text guides tool selection but cannot expand policy, approve a plan, or execute a write</span></div></div>`,
    ),
    tourPanel(
      "read",
      4,
      "Prove the first live read",
      "Inventory the exact configured guild through the real MCP path before enabling any write workflow.",
      `${tourToolLink(read, "Negotiated read tool")}<div class="tour-proof-grid"><div><b>Static contract</b><span>Bounded live read with exact input and output schemas, Discord-read annotation, and target-specific readiness requirements</span></div><div><b>Live result must prove</b><span>Pinned identity, policy scope, guild ownership, Discord permission, response validity, and the host's result handling</span></div></div>`,
    ),
    tourPanel(
      "review",
      5,
      "Produce a complete change plan",
      "Additive channel creation first gathers fresh identity, collision, capacity, parent, visibility, and permission evidence without mutating Discord.",
      `${tourToolLink(plan, "Negotiated plan tool")}<div class="tour-proof-grid"><div><b>Review surface</b><span>The same complete text and structured plan can optionally render in the display-only <a href="#app">plan-review MCP App</a></span></div><div><b>No write yet</b><span>The plan digest and signed request state describe exact reviewed evidence but do not authorize execution by themselves</span></div></div>`,
    ),
    tourPanel(
      "execute",
      6,
      "Approve one exact mutation",
      "Execution accepts only the identical request and fresh digest after host write approval and signed interactive confirmation.",
      `${tourToolLink(execute, "Negotiated execution tool")}<div class="tour-proof-grid"><div><b>Before dispatch</b><span>Final fresh-plan match, durable coordination, one-shot reservation, and pending content-free activity</span></div><div><b>After dispatch</b><span>One non-retried Discord request, strict response validation, exact readback, and explicit drift or uncertainty</span></div></div>`,
    ),
    tourPanel(
      "recover",
      7,
      "Settle ambiguity without guessing",
      "Content-free activity and durable claims separate completed, failed, drifting, and uncertain outcomes while preserving operator control.",
      `${tourToolLink(activity, "Negotiated local evidence tool")}<pre tabindex="0"><code>${escapeHtml(`npx --yes ${packageSpec} coordination list --config ./guildcontrol.json`)}</code></pre><div class="tour-proof-grid"><div><b>Evidence retains</b><span>Exact identifiers where permitted, hashes, timestamps, stages, outcomes, and sanitized error categories</span></div><div><b>Evidence excludes</b><span>Messages, names, topics, URLs, reasons, raw operation keys, credentials, and transport response bodies</span></div></div>`,
    ),
  ].join("")
  return `<div class="tour-tabs" role="tablist" aria-label="Guided product tour steps">${tabs}</div><div class="tour-panels">${panels}</div>`
}

function optionMarkup(values: readonly string[]): string {
  return [...new Set(values)].sort().map((value) => (
    `<option value="${escapeHtml(value)}">${escapeHtml(displayName(value))}</option>`
  )).join("")
}

function annotationMarkup(
  annotations: Record<string, unknown> | undefined,
): string {
  return ANNOTATION_NAMES.map((name) => {
    const enabled = annotations?.[name] === true
    return `<div class="annotation"><dt>${escapeHtml(displayName(name))}</dt><dd class="${enabled ? "yes" : "no"}">${enabled ? "Yes" : "No"}</dd></div>`
  }).join("")
}

function toolMarkup(
  tool: DiscordCatalogSnapshot["tools"][number],
  metadata: ToolMetadata,
): string {
  const title = tool.title || tool.name
  const description = tool.description || ""
  const search = [
    tool.name,
    title,
    description,
    metadata.risk,
    metadata.access.approval,
    metadata.access.authorizationEvidence,
    metadata.access.stage,
    metadata.access.requirements.authentication,
    metadata.access.requirements.discord.hierarchy,
    metadata.access.requirements.discord.permissionMode,
    metadata.access.requirements.discord.permissions.join(" "),
    metadata.access.requirements.discord.intents.map(({ name }) => name).join(" "),
    metadata.access.requirements.configuration.policyPaths.join(" "),
    metadata.toolset,
    metadata.workflow,
  ].join(" ").toLocaleLowerCase()
  const annotations = tool.annotations as Record<string, unknown> | undefined
  const ui = tool._meta?.ui as Record<string, unknown> | undefined
  const appBadge = ui?.resourceUri === MCP_PLAN_REVIEW_APP_URI
    ? '<span class="badge app-badge">Plan review app</span>'
    : ""
  const requirements = metadata.access.requirements
  const { requirements: _requirements, ...accessLifecycle } = metadata.access
  const permissionSummary = requirements.discord.permissionMode === "none"
    ? "No Discord permission"
    : requirements.discord.permissions.length > 0
      ? requirements.discord.permissions.join(", ")
      : "Runtime-dependent permission"
  const intentSummary = requirements.discord.intents.length === 0
    ? "No Gateway intent"
    : requirements.discord.intents
        .map(({ name, status }) => `${name} (${status})`)
        .join(", ")
  const conditionSummary = requirements.discord.conditions.length === 0
    ? "None"
    : requirements.discord.conditions
        .map((condition) => (
          `${condition.case}: ${condition.permissions.length > 0 ? condition.permissions.join(", ") : "no added permission"}`
        ))
        .join("; ")
  const curatedSetupSummary = [
    ...requirements.configuration.presetNames.map((name) => `preset:${name}`),
    ...requirements.configuration.recipeNames.map((name) => `recipe:${name}`),
  ].join(", ") || "None"
  return `<article class="tool-card" data-tool data-search="${escapeHtml(search)}" data-access="${escapeHtml(metadata.access.stage)}" data-risk="${escapeHtml(metadata.risk)}" data-toolset="${escapeHtml(metadata.toolset)}" data-workflow="${escapeHtml(metadata.workflow)}">
  <details id="tool-${escapeHtml(tool.name)}">
    <summary>
      <span class="summary-copy"><strong>${escapeHtml(title)}</strong><code>${escapeHtml(tool.name)}</code></span>
      <span class="badges">${appBadge}<span class="badge risk-${escapeHtml(metadata.risk)}">${escapeHtml(displayName(metadata.risk))}</span><span class="badge">${escapeHtml(metadata.access.stage)}</span><span class="badge">${escapeHtml(requirements.authentication)}</span><span class="badge">${escapeHtml(metadata.toolset)}</span></span>
    </summary>
    <div class="tool-body">
      <p>${escapeHtml(description)}</p>
      <div class="tool-meta"><span><b>Toolset</b> ${escapeHtml(metadata.toolset)}</span><span><b>Workflow</b> ${escapeHtml(metadata.workflow)}</span><span><b>Access</b> ${escapeHtml(metadata.access.stage)}</span><span><b>Readiness</b> ${escapeHtml(metadata.access.readiness)}</span><span><b>Authentication</b> ${escapeHtml(requirements.authentication)}</span><a href="#tool-${escapeHtml(tool.name)}" aria-label="Link to ${escapeHtml(tool.name)}">Permalink</a></div>
      <details class="contract-card"><summary><strong>Static setup requirements</strong><code>${escapeHtml(requirements.discord.permissionMode)}</code></summary><div><p><b>Target:</b> ${escapeHtml(requirements.targetScope)} (${escapeHtml(requirements.source)})<br><b>Permissions:</b> ${escapeHtml(permissionSummary)}<br><b>Conditional permissions:</b> ${escapeHtml(conditionSummary)}<br><b>Intents:</b> ${escapeHtml(intentSummary)}<br><b>Hierarchy:</b> ${escapeHtml(requirements.discord.hierarchy)}<br><b>Curated setup:</b> ${escapeHtml(curatedSetupSummary)}<br><b>Live verification:</b> ${escapeHtml(requirements.discord.verification)}</p><p>Policy paths are exact for an exact-tool source and form a conservative setup envelope for a toolset source. Presets and recipes are listed only when their curated contract includes this tool. This static record grants no authority and cannot prove target access.</p><pre tabindex="0"><code>${jsonText(requirements)}</code></pre></div></details>
      <details class="contract-card"><summary><strong>Access lifecycle</strong><code>${escapeHtml(metadata.access.authorizationEvidence)}</code></summary><div><p>This static contract classifies authorization but does not prove access to a Discord target.</p><pre tabindex="0"><code>${jsonText(accessLifecycle)}</code></pre></div></details>
      <dl class="annotations" aria-label="MCP tool annotations">${annotationMarkup(annotations)}</dl>
      <div class="schema-grid">
        <section><h4>Input schema</h4><pre tabindex="0"><code>${jsonText(tool.inputSchema)}</code></pre></section>
        <section><h4>Output schema</h4><pre tabindex="0"><code>${jsonText(tool.outputSchema)}</code></pre></section>
      </div>
    </div>
  </details>
</article>`
}

function promptMarkup(prompt: DiscordCatalogSnapshot["prompts"][number]): string {
  return `<details id="prompt-${escapeHtml(prompt.name)}" class="contract-card"><summary><strong>${escapeHtml(prompt.title || prompt.name)}</strong><code>${escapeHtml(prompt.name)}</code></summary><div><p>${escapeHtml(prompt.description || "No description advertised")}</p><pre tabindex="0"><code>${jsonText(prompt)}</code></pre></div></details>`
}

function resourceMarkup(resource: DiscordCatalogSnapshot["resources"][number]): string {
  return `<details class="contract-card"><summary><strong>${escapeHtml(resource.title || resource.name || resource.uri)}</strong><code>${escapeHtml(resource.uri)}</code></summary><div><p>${escapeHtml(resource.description || "No description advertised")}</p><pre tabindex="0"><code>${jsonText(resource)}</code></pre></div></details>`
}

function resourceTemplateMarkup(
  template: DiscordCatalogSnapshot["resourceTemplates"][number],
): string {
  return `<details class="contract-card"><summary><strong>${escapeHtml(template.title || template.name || template.uriTemplate)}</strong><code>${escapeHtml(template.uriTemplate)}</code></summary><div><p>${escapeHtml(template.description || "No description advertised")}</p><pre tabindex="0"><code>${jsonText(template)}</code></pre></div></details>`
}

function completionMarkup(
  binding: DiscordCatalogSnapshot["report"]["completionBindings"][number],
): string {
  const identity = `${binding.kind}:${binding.reference}:${binding.argument}`
  return `<details class="contract-card"><summary><strong>${escapeHtml(displayName(binding.argument))}</strong><code>${escapeHtml(binding.reference)}</code></summary><div><p>Completes from configured exact policy IDs only. The credential-free catalog verifies this route with zero returned identifiers.</p><pre tabindex="0"><code>${jsonText({ ...binding, identity })}</code></pre></div></details>`
}

function safetyResourceText(snapshot: DiscordCatalogSnapshot): string {
  const content = snapshot.safetyResource.contents[0]
  if (!content || !("text" in content) || typeof content.text !== "string") {
    throw new Error("Catalog HTML safety resource text is unavailable")
  }
  return content.text
}

function planReviewAppHtml(snapshot: DiscordCatalogSnapshot): string {
  const content = snapshot.planReviewAppResource.contents[0]
  if (!content || !("text" in content) || typeof content.text !== "string") {
    throw new Error("Catalog HTML plan-review app source is unavailable")
  }
  return content.text
}

function riskBars(snapshot: DiscordCatalogSnapshot): string {
  const total = snapshot.report.toolCount
  return Object.entries(snapshot.report.riskClassCounts).sort(([left], [right]) => (
    left.localeCompare(right)
  )).map(([risk, count]) => {
    const share = total === 0 ? 0 : (count / total) * 100
    return `<div class="risk-row"><span>${escapeHtml(displayName(risk))}</span><div class="risk-track"><span style="--share:${share.toFixed(4)}%"></span></div><strong>${count}</strong></div>`
  }).join("")
}

function accessBars(snapshot: DiscordCatalogSnapshot): string {
  const total = snapshot.report.toolCount
  return Object.entries(snapshot.report.accessStageCounts).sort(([left], [right]) => (
    left.localeCompare(right)
  )).map(([stage, count]) => {
    const share = total === 0 ? 0 : (count / total) * 100
    return `<div class="risk-row"><span>${escapeHtml(displayName(stage))}</span><div class="risk-track"><span style="--share:${share.toFixed(4)}%"></span></div><strong>${count}</strong></div>`
  }).join("")
}

export function renderDiscordCatalogHtml(snapshot: DiscordCatalogSnapshot): string {
  const tools = snapshot.tools.map((tool) => ({
    metadata: toolMetadata(tool.name),
    tool,
  }))
  const toolsets = tools.map(({ metadata }) => metadata.toolset)
  const risks = tools.map(({ metadata }) => metadata.risk)
  const workflows = tools.map(({ metadata }) => metadata.workflow)
  const accessStages = tools.map(({ metadata }) => metadata.access.stage)
  const report = snapshot.report
  const tourMarkup = guidedTourMarkup(snapshot, tools)
  const toolsMarkup = tools.map(({ metadata, tool }) => toolMarkup(tool, metadata)).join("\n")
  const promptsMarkup = snapshot.prompts.map(promptMarkup).join("\n")
  const completionsMarkup = report.completionBindings.map(completionMarkup).join("\n")
  const resourcesMarkup = snapshot.resources.map(resourceMarkup).join("\n")
  const templatesMarkup = snapshot.resourceTemplates.map(resourceTemplateMarkup).join("\n")
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'">
  <meta name="description" content="Credential-free, release-exact GuildControl MCP product tour and contract explorer">
  <title>GuildControl MCP Contract Explorer ${escapeHtml(report.serverVersion)}</title>
  <style>
    :root{color-scheme:light dark;--bg:#f4f6fb;--panel:#fff;--panel-2:#f8f9fd;--text:#162033;--muted:#5d687b;--line:#d8deea;--brand:#5865f2;--brand-2:#3643c8;--on-brand:#fff;--focus:#ffb020;--local:#6c5ce7;--read:#147d64;--interaction:#b85c00;--admin:#a13b78;--destructive:#bd2838;--shadow:0 18px 50px rgba(29,40,76,.09)}
    @media(prefers-color-scheme:dark){:root{--bg:#0d111b;--panel:#151b28;--panel-2:#101622;--text:#eef2ff;--muted:#aab4ca;--line:#30394c;--brand:#8993ff;--brand-2:#b1b7ff;--on-brand:#0d111b;--focus:#ffd166;--local:#a99cff;--read:#63d1b1;--interaction:#ffb56b;--admin:#ee8fc5;--destructive:#ff7d8a;--shadow:0 18px 50px rgba(0,0,0,.28)}}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55}.skip-link{position:fixed;left:1rem;top:-5rem;z-index:20;background:var(--panel);color:var(--text);padding:.7rem 1rem;border:2px solid var(--focus);border-radius:.6rem}.skip-link:focus{top:1rem}.shell{width:min(1180px,calc(100% - 2rem));margin:0 auto}.hero{padding:4.5rem 0 2.25rem}.eyebrow{margin:0 0 .5rem;color:var(--brand-2);font-size:.78rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.hero h1{max-width:850px;margin:0;font-size:clamp(2.3rem,7vw,5.4rem);line-height:.95;letter-spacing:-.055em}.lede{max-width:760px;margin:1.5rem 0 0;color:var(--muted);font-size:clamp(1rem,2vw,1.25rem)}.hero-link{display:inline-flex;margin-top:1.25rem;padding:.7rem 1rem;border:1px solid var(--brand-2);border-radius:.7rem;background:var(--brand-2);color:var(--on-brand);font-weight:800;text-decoration:none}.hero-link:hover{box-shadow:0 0 0 3px color-mix(in srgb,var(--brand-2) 30%,transparent)}.proof-strip{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:.75rem;margin:2rem 0}.proof{min-width:0;padding:1rem;border:1px solid var(--line);border-radius:1rem;background:var(--panel);box-shadow:var(--shadow)}.proof strong{display:block;font-size:1.45rem}.proof span{color:var(--muted);font-size:.82rem}.guarantees{display:grid;grid-template-columns:1.15fr .85fr;gap:1rem;margin:1rem 0 3rem}.panel{min-width:0;padding:1.25rem;border:1px solid var(--line);border-radius:1rem;background:var(--panel);box-shadow:var(--shadow)}.panel h2,.panel h3{margin-top:0}.checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.65rem;margin:0;padding:0;list-style:none}.checks li{padding:.75rem;border-radius:.75rem;background:var(--panel-2)}.checks li::before{content:"✓";margin-right:.55rem;color:var(--read);font-weight:900}.digest{overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.75rem;color:var(--muted)}.risk-row{display:grid;grid-template-columns:minmax(8rem,1fr) 2fr 2rem;align-items:center;gap:.6rem;margin:.55rem 0;font-size:.78rem}.risk-track{height:.55rem;overflow:hidden;border-radius:999px;background:var(--line)}.risk-track span{display:block;width:var(--share);height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--brand),var(--brand-2))}.sticky-nav{position:sticky;top:0;z-index:10;border-block:1px solid var(--line);background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(14px)}.nav-inner{display:flex;align-items:center;gap:1rem;overflow:auto;padding:.65rem 0}.nav-inner a{color:var(--muted);font-weight:700;text-decoration:none;white-space:nowrap}.nav-inner a:hover{color:var(--text)}main section{scroll-margin-top:5rem}.section-head{display:flex;align-items:end;justify-content:space-between;gap:1rem;margin:3.5rem 0 1rem}.section-head h2{margin:0;font-size:clamp(1.7rem,4vw,2.6rem);letter-spacing:-.035em}.section-head p{max-width:570px;margin:0;color:var(--muted)}.tour-tabs{display:flex;overflow-x:auto;border:1px solid var(--line);border-radius:1rem 1rem 0 0;background:var(--panel);scroll-snap-type:x proximity}.tour-tabs button{display:flex;flex:1 0 8rem;align-items:center;justify-content:center;gap:.45rem;border:0;border-right:1px solid var(--line);border-radius:0;background:transparent;scroll-snap-align:start}.tour-tabs button:last-child{border-right:0}.tour-tabs button span{display:grid;width:1.55rem;height:1.55rem;place-items:center;border:1px solid var(--line);border-radius:50%;color:var(--muted);font-size:.72rem}.tour-tabs button[aria-selected="true"]{background:var(--panel-2);color:var(--brand-2)}.tour-tabs button[aria-selected="true"] span{border-color:var(--brand-2);background:var(--brand-2);color:var(--on-brand)}.tour-panels{border:1px solid var(--line);border-top:0;border-radius:0 0 1rem 1rem;background:var(--panel);box-shadow:var(--shadow)}.tour-panel{min-height:25rem;padding:clamp(1.1rem,3vw,2rem)}.tour-panel[hidden]{display:none}.tour-panel h3{max-width:800px;margin:.1rem 0 .6rem;font-size:clamp(1.5rem,4vw,2.3rem);letter-spacing:-.03em}.tour-summary{max-width:800px;margin:0 0 1.25rem;color:var(--muted);font-size:1.05rem}.tour-proof-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem;margin-top:1rem}.tour-proof-grid div{display:grid;gap:.35rem;padding:1rem;border-radius:.8rem;background:var(--panel-2)}.tour-proof-grid span{color:var(--muted)}.tour-contract-link{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:.75rem;padding:1rem;border:1px solid var(--line);border-radius:.8rem;background:var(--panel-2);color:var(--text);text-decoration:none}.tour-contract-link:hover{border-color:var(--brand)}.tour-contract-link span{font-weight:800}.tour-contract-link code{overflow-wrap:anywhere;color:var(--brand-2)}.tour-contract-link strong{padding:.22rem .5rem;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:.7rem}.controls{display:grid;grid-template-columns:minmax(15rem,2fr) repeat(4,minmax(8rem,1fr));gap:.75rem;padding:1rem;border:1px solid var(--line);border-radius:1rem 1rem 0 0;background:var(--panel)}label{display:grid;gap:.35rem;color:var(--muted);font-size:.75rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em}input,select,button{min-height:2.7rem;border:1px solid var(--line);border-radius:.65rem;background:var(--panel-2);color:var(--text);font:inherit}input,select{width:100%;padding:.55rem .7rem}input:focus-visible,select:focus-visible,button:focus-visible,a:focus-visible,summary:focus-visible,pre:focus-visible,[role="tabpanel"]:focus-visible{outline:3px solid var(--focus);outline-offset:2px}.control-footer{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.8rem 1rem;border:1px solid var(--line);border-top:0;background:var(--panel)}.button-row{display:flex;flex-wrap:wrap;gap:.5rem}button{padding:.45rem .8rem;cursor:pointer;font-weight:750}button:hover{border-color:var(--brand);color:var(--brand-2)}#filter-status{color:var(--muted);font-size:.9rem}.tool-list{display:grid;gap:.65rem;margin-top:.75rem}.tool-card,.contract-card{border:1px solid var(--line);border-radius:.85rem;background:var(--panel);box-shadow:0 8px 25px rgba(29,40,76,.04)}.tool-card[hidden]{display:none}.tool-card details,.contract-card{overflow:hidden}.tool-card summary,.contract-card summary{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem;cursor:pointer}.summary-copy,.contract-card summary{min-width:0}.summary-copy strong,.summary-copy code,.contract-card summary strong,.contract-card summary code{display:block}.summary-copy code,.contract-card summary code{overflow-wrap:anywhere;color:var(--muted);font-size:.76rem}.badges{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:.35rem}.badge{padding:.23rem .5rem;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:.68rem;font-weight:800;white-space:nowrap}.app-badge{color:var(--brand-2);border-color:var(--brand)}.risk-local-read{color:var(--local)}.risk-discord-read{color:var(--read)}.risk-interaction-write{color:var(--interaction)}.risk-administrative-write{color:var(--admin)}.risk-destructive-write{color:var(--destructive)}.tool-body,.contract-card>div{padding:0 1rem 1rem;border-top:1px solid var(--line)}.tool-body>p,.contract-card p{white-space:pre-wrap}.tool-meta{display:flex;flex-wrap:wrap;gap:.5rem 1rem;padding:.65rem .75rem;border-radius:.65rem;background:var(--panel-2);font-size:.82rem}.tool-meta a{margin-left:auto;color:var(--brand-2)}.annotations{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.5rem;margin:1rem 0}.annotation{padding:.65rem;border:1px solid var(--line);border-radius:.65rem}.annotation dt{color:var(--muted);font-size:.7rem}.annotation dd{margin:0;font-weight:800}.annotation .yes{color:var(--read)}.annotation .no{color:var(--muted)}.schema-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.schema-grid h4{margin:.4rem 0}.schema-grid section{min-width:0}pre{max-height:32rem;overflow:auto;margin:.5rem 0 0;padding:1rem;border:1px solid var(--line);border-radius:.7rem;background:var(--panel-2);font-size:.74rem;line-height:1.45;tab-size:2}code{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}.contract-list{display:grid;gap:.65rem}.split{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.safety{margin-bottom:4rem}.safety pre{max-height:none;white-space:pre-wrap}.empty-note{display:none;margin:1rem 0;padding:1rem;border:1px dashed var(--line);border-radius:.8rem;color:var(--muted)}.empty-note.visible{display:block}footer{padding:2rem 0 4rem;border-top:1px solid var(--line);color:var(--muted);font-size:.82rem}
    @media(max-width:860px){.proof-strip{grid-template-columns:repeat(2,minmax(0,1fr))}.guarantees,.split,.schema-grid{grid-template-columns:minmax(0,1fr)}.controls{grid-template-columns:repeat(2,minmax(0,1fr))}.annotations{grid-template-columns:repeat(2,minmax(0,1fr))}.tour-proof-grid{grid-template-columns:minmax(0,1fr)}}
    @media(max-width:560px){.shell{width:min(100% - 1rem,1180px)}.hero{padding-top:2.75rem}.proof-strip,.controls,.checks{grid-template-columns:minmax(0,1fr)}.section-head{align-items:start;flex-direction:column}.control-footer,.tool-card summary{align-items:stretch;flex-direction:column}.badges{justify-content:flex-start}.annotations{grid-template-columns:minmax(0,1fr)}.nav-inner{gap:.75rem}}
    @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
  </style>
</head>
<body>
  <a class="skip-link" href="#main">Skip to contract</a>
  <header class="shell hero">
    <p class="eyebrow">Credential-free release inspection</p>
    <h1>GuildControl MCP Contract Explorer</h1>
    <p class="lede">A self-contained view of the exact MCP contract negotiated from version ${escapeHtml(report.serverVersion)}. This artifact cannot execute a tool, contact Discord, read a credential, expose completion IDs, open the Gateway, export telemetry, or create an activity record.</p>
    <a class="hero-link" href="#tour">Start the guided product tour</a>
    <div class="proof-strip" role="list" aria-label="Catalog summary">
      <div class="proof" role="listitem"><strong>${report.toolCount}</strong><span>Exact tools</span></div>
      <div class="proof" role="listitem"><strong>${report.promptCount}</strong><span>Prompts</span></div>
      <div class="proof" role="listitem"><strong>${report.resourceCount + report.resourceTemplateCount}</strong><span>Resources and templates</span></div>
      <div class="proof" role="listitem"><strong>${report.completionBindingCount}</strong><span>Policy completion routes</span></div>
      <div class="proof" role="listitem"><strong>${report.restOperationCount}</strong><span>Mapped REST operations</span></div>
      <div class="proof" role="listitem"><strong>${report.planReviewApp.linkedToolCount}</strong><span>Interactive plan reviews</span></div>
    </div>
    <div class="guarantees">
      <section class="panel"><h2>What this proves</h2><ul class="checks"><li>Production registrations negotiated</li><li>Complete tool annotations checked</li><li>Every access lifecycle classified</li><li>Every static setup requirement classified</li><li>Known and unknown calls blocked identically</li><li>Policy completion routes return zero catalog IDs</li><li>No credential or Discord execution available</li></ul></section>
      <section class="panel"><h2>Risk distribution</h2>${riskBars(snapshot)}<h3>Access lifecycle</h3>${accessBars(snapshot)}<p class="digest"><b>Contract</b><br>${escapeHtml(report.contractDigest)}<br><br><b>Tool access</b><br>${escapeHtml(report.toolAccessResourceDigest)}<br><br><b>Safety</b><br>${escapeHtml(report.safetyResourceDigest)}<br><br><b>Plan-review HTML</b><br>${escapeHtml(report.planReviewApp.htmlDigest)}</p></section>
    </div>
  </header>
  <nav class="sticky-nav" aria-label="Contract sections"><div class="shell nav-inner"><a href="#tour">Tour</a><a href="#tools">Tools</a><a href="#app">Plan-review app</a><a href="#prompts">Prompts</a><a href="#completions">Completions</a><a href="#resources">Resources</a><a href="#instructions">Instructions</a><a href="#safety">Safety</a></div></nav>
  <main id="main" class="shell">
    <section id="tour">
      <div class="section-head"><div><p class="eyebrow">Release-exact workflow map</p><h2>Guided product tour</h2></div><p>Follow one safe operator journey from package inspection through a verified read, reviewed change, and ambiguity recovery. This is negotiated contract evidence, not a recording or simulated Discord response.</p></div>
      ${tourMarkup}
    </section>
    <section id="tools">
      <div class="section-head"><div><p class="eyebrow">Exact callable surface</p><h2>Tools</h2></div><p>Search names, permissions, intents, policy paths, and descriptions, then narrow by internal toolset, MCP risk class, access lifecycle, or complete reviewed workflow. Static setup metadata never claims target readiness.</p></div>
      <div class="controls" role="group" aria-label="Tool filters">
        <label for="tool-search">Search<input id="tool-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search tools and capabilities"></label>
        <label for="toolset-filter">Toolset<select id="toolset-filter"><option value="">All toolsets</option>${optionMarkup(toolsets)}</select></label>
        <label for="risk-filter">Risk<select id="risk-filter"><option value="">All risk classes</option>${optionMarkup(risks)}</select></label>
        <label for="access-filter">Access<select id="access-filter"><option value="">All access stages</option>${optionMarkup(accessStages)}</select></label>
        <label for="workflow-filter">Workflow<select id="workflow-filter"><option value="">All workflows</option>${optionMarkup(workflows)}</select></label>
      </div>
      <div class="control-footer"><span id="filter-status" role="status" aria-live="polite">${report.toolCount} of ${report.toolCount} tools shown</span><div class="button-row"><button id="reset-filters" type="button">Reset</button><button id="expand-tools" type="button">Expand visible</button><button id="collapse-tools" type="button">Collapse all</button></div></div>
      <p id="empty-tools" class="empty-note">No tools match these filters.</p>
      <div class="tool-list">${toolsMarkup}</div>
    </section>
    <section id="app">
      <div class="section-head"><div><p class="eyebrow">Progressive visual review</p><h2>Plan-review MCP App</h2></div><p>Every configured canonical plan tool can render this optional display-only view. Text and structured results remain complete in clients without MCP Apps.</p></div>
      <div class="split">
        <div class="panel"><h3>Bounded authority</h3><ul class="checks"><li>Model-visible plan tools only</li><li>No app-callable server tools</li><li>No external network domains</li><li>No browser permissions</li><li>No approval or execution action</li><li>Untrusted values use text nodes</li></ul></div>
        <div class="panel"><h3>Release evidence</h3><pre tabindex="0"><code>${jsonText(report.planReviewApp)}</code></pre></div>
      </div>
      <details class="contract-card"><summary><strong>Exact self-contained app source</strong><code>${escapeHtml(report.planReviewApp.resourceUri)}</code></summary><div><p>The bytes below match the reported HTML digest and the resource response bound into the overall contract digest.</p><pre tabindex="0"><code>${escapeHtml(planReviewAppHtml(snapshot))}</code></pre></div></details>
    </section>
    <section id="prompts">
      <div class="section-head"><div><p class="eyebrow">Review-oriented guidance</p><h2>Prompts</h2></div><p>Negotiated prompt declarations are shown exactly as the release advertises them.</p></div>
      <div class="contract-list">${promptsMarkup}</div>
    </section>
    <section id="completions">
      <div class="section-head"><div><p class="eyebrow">Exact-ID ergonomics</p><h2>Policy completions</h2></div><p>Every route is prefix-only, deterministic, bounded to ${MCP_COMPLETION_VALUE_LIMIT} values, and sourced from an already-exposed strict policy array. Catalog inspection registers the routes while returning no identifiers.</p></div>
      <div class="contract-list">${completionsMarkup}</div>
    </section>
    <section id="resources">
      <div class="section-head"><div><p class="eyebrow">Protocol context</p><h2>Resources</h2></div><p>Fixed resources and parameterized resource templates remain distinct so clients can reason about stable and target-specific context.</p></div>
      <div class="split"><div><h3>Fixed resources</h3><div class="contract-list">${resourcesMarkup}</div></div><div><h3>Resource templates</h3><div class="contract-list">${templatesMarkup}</div></div></div>
    </section>
    <section id="instructions">
      <div class="section-head"><div><p class="eyebrow">Server-level contract</p><h2>Instructions and guard</h2></div><p>The catalog server's exact instructions and fixed blocked-call result are included for independent review.</p></div>
      <div class="split"><div class="panel"><h3>Instructions</h3><pre tabindex="0"><code>${escapeHtml(snapshot.instructions)}</code></pre></div><div class="panel"><h3>Execution guard</h3><pre tabindex="0"><code>${jsonText(snapshot.executionGuard)}</code></pre></div></div>
    </section>
    <section id="safety" class="safety">
      <div class="section-head"><div><p class="eyebrow">Fingerprint-bound guidance</p><h2>Static safety resource</h2></div><p>This is the exact text covered by the safety-resource digest above.</p></div>
      <div class="panel"><pre tabindex="0"><code>${escapeHtml(safetyResourceText(snapshot))}</code></pre></div>
    </section>
  </main>
  <footer><div class="shell"><b>${escapeHtml(CATALOG_HTML_FORMAT)}</b><br>Server ${escapeHtml(report.serverName)} ${escapeHtml(report.serverVersion)}. Deterministic inspection artifact with no external assets or runtime network access.</div></footer>
  <script>
    (() => {
      'use strict';
      const tourTabs = Array.from(document.querySelectorAll('[data-tour-tab]'));
      const tourPanels = tourTabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));
      const selectTourTab = (index, moveFocus) => {
        for (const [candidateIndex, tab] of tourTabs.entries()) {
          const selected = candidateIndex === index;
          tab.setAttribute('aria-selected', selected ? 'true' : 'false');
          tab.tabIndex = selected ? 0 : -1;
          tourPanels[candidateIndex].hidden = !selected;
        }
        if (moveFocus) tourTabs[index].focus();
      };
      for (const [index, tab] of tourTabs.entries()) {
        tab.addEventListener('click', () => selectTourTab(index, false));
        tab.addEventListener('keydown', (event) => {
          let nextIndex;
          if (event.key === 'ArrowRight') nextIndex = (index + 1) % tourTabs.length;
          else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tourTabs.length) % tourTabs.length;
          else if (event.key === 'Home') nextIndex = 0;
          else if (event.key === 'End') nextIndex = tourTabs.length - 1;
          if (nextIndex === undefined) return;
          event.preventDefault();
          selectTourTab(nextIndex, true);
        });
      }
      const cards = Array.from(document.querySelectorAll('[data-tool]'));
      const search = document.getElementById('tool-search');
      const toolset = document.getElementById('toolset-filter');
      const risk = document.getElementById('risk-filter');
      const access = document.getElementById('access-filter');
      const workflow = document.getElementById('workflow-filter');
      const status = document.getElementById('filter-status');
      const empty = document.getElementById('empty-tools');
      const applyFilters = () => {
        const query = search.value.trim().toLocaleLowerCase();
        let visible = 0;
        for (const card of cards) {
          const matches = (!query || card.dataset.search.includes(query))
            && (!toolset.value || card.dataset.toolset === toolset.value)
            && (!risk.value || card.dataset.risk === risk.value)
            && (!access.value || card.dataset.access === access.value)
            && (!workflow.value || card.dataset.workflow === workflow.value);
          card.hidden = !matches;
          if (matches) visible += 1;
        }
        status.textContent = visible + ' of ' + cards.length + ' tools shown';
        empty.classList.toggle('visible', visible === 0);
      };
      for (const control of [search, toolset, risk, access, workflow]) {
        control.addEventListener(control === search ? 'input' : 'change', applyFilters);
      }
      document.getElementById('reset-filters').addEventListener('click', () => {
        search.value = '';
        toolset.value = '';
        risk.value = '';
        access.value = '';
        workflow.value = '';
        applyFilters();
        search.focus();
      });
      document.getElementById('expand-tools').addEventListener('click', () => {
        for (const card of cards) if (!card.hidden) card.querySelector('details').open = true;
      });
      document.getElementById('collapse-tools').addEventListener('click', () => {
        for (const card of cards) card.querySelector('details').open = false;
      });
      const openHash = () => {
        if (!location.hash) return;
        let identifier;
        try {
          identifier = decodeURIComponent(location.hash.slice(1));
        } catch {
          return;
        }
        const target = document.getElementById(identifier);
        if (target && target.tagName === 'DETAILS') target.open = true;
        if (target && target.matches('[data-tour-tab]')) {
          selectTourTab(tourTabs.indexOf(target), false);
        }
        if (target && target.matches('[role="tabpanel"]')) {
          const tab = document.getElementById(target.getAttribute('aria-labelledby'));
          selectTourTab(tourTabs.indexOf(tab), false);
        }
      };
      addEventListener('hashchange', openHash);
      openHash();
    })();
  </script>
</body>
</html>
`
}

export async function exportDiscordCatalogHtml(
  file: string,
  options: DiscordCatalogHtmlExportOptions = {},
): Promise<DiscordCatalogHtmlExportReport> {
  const target = resolveExclusivePrivateFile(file, CATALOG_HTML_FILE_MESSAGES)
  const snapshot = await (options.inspect || inspectDiscordCatalog)()
  const content = renderDiscordCatalogHtml(snapshot)
  await writeExclusivePrivateFile(
    target,
    content,
    CATALOG_HTML_FILE_MESSAGES,
    options.fileSystem,
  )
  return {
    activityRecordsCreated: false,
    bytes: Buffer.byteLength(content),
    contractDigest: snapshot.report.contractDigest,
    credentialsRequired: false,
    discordExecution: "disabled",
    file: target,
    format: CATALOG_HTML_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    status: "ok",
    toolCount: snapshot.report.toolCount,
  }
}
