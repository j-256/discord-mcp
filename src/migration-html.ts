import { createHash } from "node:crypto"

import { ConfigurationError } from "./errors.js"
import {
  resolveExclusivePrivateFile,
  writeExclusivePrivateFile,
  type ExclusivePrivateFileSystem,
} from "./exclusive-private-file.js"
import {
  MIGRATION_REPORT_SCHEMA_VERSION,
  verifyMigrationPlan,
  type MigrationOutcomeMapping,
  type MigrationPlanReport,
  type MigrationPlanStep,
} from "./migration-planner.js"

export const MIGRATION_HTML_FORMAT = "guildcontrol.migration-html.v1"

export interface DiscordMigrationHtmlExportOptions {
  fileSystem?: ExclusivePrivateFileSystem
}

export interface DiscordMigrationHtmlExportReport {
  readonly activityRecordsCreated: false
  readonly automaticNetwork: "disabled"
  readonly browserOpened: false
  readonly bytes: number
  readonly configurationChanged: false
  readonly credentialValuesEmbedded: false
  readonly credentialValuesRead: false
  readonly discordContacted: false
  readonly file: string
  readonly format: typeof MIGRATION_HTML_FORMAT
  readonly htmlDigest: string
  readonly outputFileCreated: true
  readonly planDigest: string
  readonly schemaVersion: typeof MIGRATION_REPORT_SCHEMA_VERSION
  readonly sourceId: string
  readonly statePersistence: "disabled"
  readonly status: "ok"
}

const MIGRATION_HTML_FILE_MESSAGES = Object.freeze({
  exists: "Migration HTML target already exists; choose a new path or move the existing file",
  failure: "Migration HTML export could not be written",
  invalidPath: "Migration HTML export requires a valid file path",
})

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function safeHttpsUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new ConfigurationError("Migration HTML evidence links must be valid HTTPS URLs")
  }
  if (parsed.protocol !== "https:") {
    throw new ConfigurationError("Migration HTML evidence links must be valid HTTPS URLs")
  }
  return parsed.toString()
}

function displayName(value: string): string {
  return value
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function chips(values: readonly string[], empty: string): string {
  if (values.length === 0) return `<span class="empty">${escapeHtml(empty)}</span>`
  return `<ul class="chips">${values.map((value) => `<li><code>${escapeHtml(value)}</code></li>`).join("")}</ul>`
}

function copyButton(identifier: string, label: string): string {
  return `<button class="copy" type="button" data-copy="${escapeHtml(identifier)}" aria-label="Copy ${escapeHtml(label)}">Copy</button>`
}

function stepMarkup(step: MigrationPlanStep, index: number): string {
  const commands = step.commands.length === 0
    ? '<p class="manual">No command is run automatically. Complete this decision in the source host and Discord Developer Portal.</p>'
    : step.commands.map((command, commandIndex) => {
        const identifier = `command-${index}-${commandIndex}`
        return `<div class="command"><pre id="${identifier}" tabindex="0"><code>${escapeHtml(command)}</code></pre>${copyButton(identifier, `step ${index + 1} command ${commandIndex + 1}`)}</div>`
      }).join("")
  return `<article class="step" data-step>
  <div class="step-number">${index + 1}</div>
  <div class="step-content"><p class="eyebrow">${escapeHtml(step.id)}</p><h3>${escapeHtml(step.title)}</h3>${commands}<p class="completion"><strong>Done when:</strong> ${escapeHtml(step.completion)}</p></div>
  <label class="check"><input type="checkbox" autocomplete="off" data-check aria-label="Mark ${escapeHtml(step.title)} complete"><span>Checked</span></label>
</article>`
}

function mappingMarkup(mapping: MigrationOutcomeMapping): string {
  const searchText = [
    mapping.id,
    mapping.outcome,
    mapping.disposition,
    mapping.instruction,
    mapping.trustChange,
    ...mapping.sourceTools,
    ...mapping.targetTools,
    ...mapping.recipes,
  ].join(" ").toLowerCase()
  return `<article class="mapping" data-mapping data-disposition="${escapeHtml(mapping.disposition)}" data-search="${escapeHtml(searchText)}">
  <div class="mapping-head"><div><p class="eyebrow">${escapeHtml(mapping.id)}</p><h3>${escapeHtml(mapping.outcome)}</h3></div><span class="badge ${escapeHtml(mapping.disposition)}">${escapeHtml(displayName(mapping.disposition))}</span></div>
  <p>${escapeHtml(mapping.instruction)}</p>
  <div class="route-grid">
    <section><h4>Source tools</h4>${chips(mapping.sourceTools, "No source tools")}</section>
    <section><h4>Target tools</h4>${chips(mapping.targetTools, mapping.disposition === "intentionally-excluded" ? "Deliberately no connector equivalent" : "Host-side orchestration")}</section>
    <section><h4>Configuration recipes</h4>${chips(mapping.recipes, "Use the baseline or exact-scope workbench")}</section>
  </div>
  <p class="trust"><strong>Trust-model change:</strong> ${escapeHtml(mapping.trustChange)}</p>
</article>`
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

export function renderDiscordMigrationHtml(plan: MigrationPlanReport): string {
  if (!verifyMigrationPlan(plan)) {
    throw new ConfigurationError("Migration HTML requires an exact verified plan")
  }
  const evidenceUrl = safeHttpsUrl(plan.source.evidenceUrl)
  const registryUrl = safeHttpsUrl(plan.source.registryUrl)
  const exactPlan = JSON.stringify(plan, null, 2)
  const counts = plan.summary.dispositionToolCounts
  const steps = plan.steps.map(stepMarkup).join("")
  const mappings = plan.mappings.map(mappingMarkup).join("")
  const limitations = plan.limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join("")
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="guildcontrol-format" content="${MIGRATION_HTML_FORMAT}">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
  <title>${escapeHtml(plan.source.product)} ${escapeHtml(plan.source.version)} migration plan</title>
  <style>
    :root { color-scheme: light dark; --bg: #f5f3ff; --panel: rgba(255,255,255,.86); --ink: #17132d; --muted: #5e5874; --line: #dcd7f2; --accent: #5b3fd3; --accent2: #007d74; --warn: #9c4a00; --excluded: #8a285c; --shadow: 0 18px 55px rgba(37,26,78,.12); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    @media (prefers-color-scheme: dark) { :root { --bg: #100d1d; --panel: rgba(27,23,45,.92); --ink: #f3efff; --muted: #bdb5d2; --line: #3c3554; --accent: #a995ff; --accent2: #63d9cb; --warn: #ffb56f; --excluded: #ff91c6; --shadow: 0 18px 55px rgba(0,0,0,.35); } }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; background: radial-gradient(circle at 8% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 34rem), radial-gradient(circle at 95% 20%, color-mix(in srgb, var(--accent2) 12%, transparent), transparent 30rem), var(--bg); color: var(--ink); line-height: 1.55; }
    a { color: var(--accent); text-underline-offset: .18em; }
    button, input, select { font: inherit; }
    button, input, select, summary, a { outline-offset: 3px; }
    .shell { width: min(1180px, calc(100% - 2rem)); margin: 0 auto; }
    header { padding: 4.5rem 0 2.4rem; }
    .kicker, .eyebrow { margin: 0 0 .45rem; color: var(--accent2); font-size: .76rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    h1 { max-width: 900px; margin: 0; font-size: clamp(2.25rem, 7vw, 5.2rem); line-height: .98; letter-spacing: -.055em; }
    h2 { margin: 0 0 1rem; font-size: clamp(1.55rem, 3vw, 2.25rem); letter-spacing: -.025em; }
    h3 { margin: 0; font-size: 1.18rem; }
    h4 { margin: 0 0 .6rem; font-size: .78rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
    .lede { max-width: 800px; margin: 1.25rem 0 0; color: var(--muted); font-size: 1.08rem; }
    .evidence { display: flex; flex-wrap: wrap; gap: .65rem 1rem; margin-top: 1.35rem; }
    .evidence a { font-weight: 700; }
    .proof-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: .8rem; margin: 2rem 0 0; }
    .proof { padding: 1rem; border: 1px solid var(--line); border-radius: 16px; background: var(--panel); box-shadow: var(--shadow); }
    .proof strong { display: block; font-size: 1.7rem; line-height: 1.1; }
    .proof span { color: var(--muted); font-size: .86rem; }
    main { padding-bottom: 4rem; }
    .panel { margin: 1rem 0 2rem; padding: clamp(1rem, 3vw, 1.6rem); border: 1px solid var(--line); border-radius: 22px; background: var(--panel); box-shadow: var(--shadow); }
    .boundary { display: grid; grid-template-columns: repeat(3, 1fr); gap: .7rem; }
    .boundary div { padding: .85rem; border: 1px solid var(--line); border-radius: 14px; }
    .boundary strong { display: block; }
    .boundary span { color: var(--muted); font-size: .88rem; }
    .progress { height: 8px; border-radius: 999px; overflow: hidden; background: var(--line); }
    .progress span { display: block; width: 0; height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent2)); transition: width .2s ease; }
    .progress-label { margin: .5rem 0 1rem; color: var(--muted); }
    .step { display: grid; grid-template-columns: 2.4rem 1fr auto; gap: 1rem; align-items: start; padding: 1rem 0; border-top: 1px solid var(--line); }
    .step-number { display: grid; place-items: center; width: 2.2rem; height: 2.2rem; border-radius: 50%; background: var(--accent); color: white; font-weight: 800; }
    .step-content { min-width: 0; }
    .command { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .55rem; margin-top: .7rem; }
    pre { margin: 0; padding: .85rem; border-radius: 12px; overflow: auto; background: color-mix(in srgb, var(--ink) 7%, transparent); border: 1px solid var(--line); white-space: pre-wrap; overflow-wrap: anywhere; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .copy, .reset { align-self: stretch; border: 1px solid var(--line); border-radius: 10px; padding: .55rem .8rem; background: transparent; color: var(--ink); cursor: pointer; font-weight: 700; }
    .copy:hover, .reset:hover { border-color: var(--accent); color: var(--accent); }
    .completion, .manual { color: var(--muted); }
    .check { display: flex; gap: .35rem; align-items: center; font-size: .84rem; font-weight: 700; }
    .filters { position: sticky; top: .7rem; z-index: 5; display: grid; grid-template-columns: 1fr 14rem auto; gap: .7rem; margin-bottom: 1rem; padding: .8rem; border: 1px solid var(--line); border-radius: 16px; background: color-mix(in srgb, var(--panel) 94%, transparent); backdrop-filter: blur(16px); }
    .filters label { display: grid; gap: .25rem; color: var(--muted); font-size: .78rem; font-weight: 700; }
    .filters input, .filters select { width: 100%; padding: .65rem .7rem; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--ink); }
    .mapping { margin-top: .85rem; padding: 1rem; border: 1px solid var(--line); border-radius: 16px; background: color-mix(in srgb, var(--panel) 80%, transparent); }
    .mapping[hidden] { display: none; }
    .mapping-head { display: flex; justify-content: space-between; gap: 1rem; align-items: start; }
    .badge { flex: 0 0 auto; padding: .25rem .55rem; border: 1px solid currentColor; border-radius: 999px; font-size: .74rem; font-weight: 800; }
    .badge.supported { color: var(--accent2); }
    .badge.review-required { color: var(--warn); }
    .badge.intentionally-excluded { color: var(--excluded); }
    .route-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem; margin-top: 1rem; }
    .route-grid section { min-width: 0; padding: .8rem; border: 1px solid var(--line); border-radius: 12px; }
    .chips { display: flex; flex-wrap: wrap; gap: .35rem; margin: 0; padding: 0; list-style: none; }
    .chips li { max-width: 100%; }
    .chips code { display: block; max-width: 100%; padding: .2rem .4rem; border-radius: 6px; background: color-mix(in srgb, var(--accent) 9%, transparent); overflow-wrap: anywhere; }
    .empty, .trust { color: var(--muted); }
    .status { min-height: 1.4rem; color: var(--accent2); font-weight: 700; }
    details summary { cursor: pointer; font-weight: 800; }
    details pre { margin-top: 1rem; max-height: 34rem; }
    footer { padding: 2rem 0 3rem; border-top: 1px solid var(--line); color: var(--muted); }
    .digest { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    @media (max-width: 800px) { .proof-grid, .boundary, .route-grid { grid-template-columns: 1fr 1fr; } .filters { position: static; grid-template-columns: 1fr; } }
    @media (max-width: 560px) { header { padding-top: 2.8rem; } .proof-grid, .boundary, .route-grid { grid-template-columns: 1fr; } .step { grid-template-columns: 2.2rem 1fr; } .check { grid-column: 2; } .command { grid-template-columns: 1fr; } .copy { justify-self: start; } }
    @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } .progress span { transition: none; } }
  </style>
</head>
<body>
  <header class="shell">
    <p class="kicker">Release-exact migration plan</p>
    <h1>${escapeHtml(plan.source.product)} <span>${escapeHtml(plan.source.version)}</span> to GuildControl MCP</h1>
    <p class="lede">A complete outcome-level switching plan bound to an audited source inventory and the exact negotiated target catalog. It is guidance, not an automatic importer.</p>
    <div class="evidence"><a href="${escapeHtml(evidenceUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Inspect source evidence</a><a href="${escapeHtml(registryUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Inspect Registry release</a></div>
    <div class="proof-grid">
      <div class="proof"><strong>${plan.summary.sourceToolCount}</strong><span>source tools accounted</span></div>
      <div class="proof"><strong>${counts.supported}</strong><span>supported tools</span></div>
      <div class="proof"><strong>${counts["review-required"]}</strong><span>tools requiring review</span></div>
      <div class="proof"><strong>${counts["intentionally-excluded"]}</strong><span>tools deliberately excluded</span></div>
    </div>
  </header>
  <main class="shell">
    <section class="panel" aria-labelledby="boundary-title"><h2 id="boundary-title">What this page did</h2><div class="boundary"><div><strong>No source scan</strong><span>The source release is selected from a shipped immutable manifest.</span></div><div><strong>No credentials or Discord</strong><span>No environment value, token, configuration, network, or Discord endpoint was read.</span></div><div><strong>No mutation</strong><span>No source, policy, MCP host, browser state, or activity record was changed.</span></div></div></section>
    <section class="panel" aria-labelledby="steps-title"><h2 id="steps-title">Staged switching path</h2><div class="progress" aria-hidden="true"><span id="progress-bar"></span></div><p class="progress-label" id="progress-label" role="status" aria-live="polite">0 of ${plan.steps.length} steps checked</p>${steps}</section>
    <section class="panel" aria-labelledby="map-title"><h2 id="map-title">Complete outcome map</h2><p>Every audited source tool appears once. Target names identify the safer outcome route, not argument compatibility or granted authority.</p>
      <div class="filters" role="search"><label>Search outcomes and tools<input id="search" type="search" autocomplete="off" placeholder="e.g. messages, automod, webhook"></label><label>Disposition<select id="disposition"><option value="">All dispositions</option><option value="supported">Supported</option><option value="review-required">Review required</option><option value="intentionally-excluded">Intentionally excluded</option></select></label><button class="reset" id="reset" type="button">Reset</button></div>
      <p id="filter-status" class="status" role="status" aria-live="polite"></p>
      <div id="mappings">${mappings}</div>
    </section>
    <section class="panel" aria-labelledby="limits-title"><h2 id="limits-title">Limits and operator obligations</h2><ul>${limitations}</ul></section>
    <details class="panel"><summary>Inspect the exact machine-readable plan</summary><pre tabindex="0"><code>${escapeHtml(exactPlan)}</code></pre></details>
    <p id="copy-status" class="status" role="status" aria-live="polite"></p>
  </main>
  <footer><div class="shell"><p>This standalone page is deterministic and private by default. Checklist and filter state exist only in memory and reset on reload. Evidence links navigate only when you activate them; the page performs no automatic request.</p><p class="digest">Source manifest ${escapeHtml(plan.source.manifestDigest)}<br>Target catalog ${escapeHtml(plan.target.catalogContractDigest)}<br>Plan ${escapeHtml(plan.planDigest)}</p></div></footer>
  <script>
    (() => {
      const search = document.getElementById('search');
      const disposition = document.getElementById('disposition');
      const cards = [...document.querySelectorAll('[data-mapping]')];
      const filterStatus = document.getElementById('filter-status');
      const applyFilters = () => {
        const query = search.value.trim().toLowerCase();
        let visible = 0;
        for (const card of cards) {
          const matches = (!query || card.dataset.search.includes(query)) && (!disposition.value || card.dataset.disposition === disposition.value);
          card.hidden = !matches;
          if (matches) visible += 1;
        }
        filterStatus.textContent = visible + ' of ' + cards.length + ' outcome groups shown';
      };
      search.addEventListener('input', applyFilters);
      disposition.addEventListener('change', applyFilters);
      document.getElementById('reset').addEventListener('click', () => { search.value = ''; disposition.value = ''; applyFilters(); search.focus(); });
      applyFilters();
      const checks = [...document.querySelectorAll('[data-check]')];
      const updateProgress = () => {
        const done = checks.filter((check) => check.checked).length;
        document.getElementById('progress-bar').style.width = (checks.length ? done / checks.length * 100 : 0) + '%';
        document.getElementById('progress-label').textContent = done + ' of ' + checks.length + ' steps checked';
      };
      for (const check of checks) check.addEventListener('change', updateProgress);
      updateProgress();
      const copyStatus = document.getElementById('copy-status');
      const copyText = async (text) => {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.append(area);
        area.select();
        const copied = document.execCommand('copy');
        area.remove();
        if (!copied) throw new Error('copy unavailable');
      };
      for (const button of document.querySelectorAll('[data-copy]')) {
        button.addEventListener('click', async () => {
          const source = document.getElementById(button.dataset.copy);
          try {
            await copyText(source.textContent);
            copyStatus.textContent = 'Copied ' + button.getAttribute('aria-label').replace(/^Copy /, '') + '.';
          } catch {
            copyStatus.textContent = 'Copy is unavailable in this browser. Select the command manually.';
          }
        });
      }
    })();
  </script>
</body>
</html>
`
}

export async function exportDiscordMigrationHtml(
  file: string,
  plan: MigrationPlanReport,
  options: DiscordMigrationHtmlExportOptions = {},
): Promise<DiscordMigrationHtmlExportReport> {
  const target = resolveExclusivePrivateFile(file, MIGRATION_HTML_FILE_MESSAGES)
  const content = renderDiscordMigrationHtml(plan)
  await writeExclusivePrivateFile(
    target,
    content,
    MIGRATION_HTML_FILE_MESSAGES,
    options.fileSystem,
  )
  return Object.freeze({
    activityRecordsCreated: false,
    automaticNetwork: "disabled",
    browserOpened: false,
    bytes: Buffer.byteLength(content),
    configurationChanged: false,
    credentialValuesEmbedded: false,
    credentialValuesRead: false,
    discordContacted: false,
    file: target,
    format: MIGRATION_HTML_FORMAT,
    htmlDigest: digest(content),
    outputFileCreated: true,
    planDigest: plan.planDigest,
    schemaVersion: MIGRATION_REPORT_SCHEMA_VERSION,
    sourceId: plan.source.id,
    statePersistence: "disabled",
    status: "ok",
  })
}
