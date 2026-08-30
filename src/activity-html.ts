import { createHash } from "node:crypto"

import {
  verifyDiscordActivityReviewReport,
  type ActivityReviewCount,
  type ActivityReviewRecord,
  type DiscordActivityReviewReport,
} from "./activity-review.js"
import { CONNECTOR_VERSION } from "./constants.js"
import { ConfigurationError } from "./errors.js"
import {
  resolveExclusivePrivateFile,
  writeExclusivePrivateFile,
  type ExclusivePrivateFileSystem,
} from "./exclusive-private-file.js"
import type { WriteCoordinationClaimStatus } from "./write-coordination.js"

export const ACTIVITY_HTML_FORMAT = "guildcontrol.activity-html.v1"
export const ACTIVITY_HTML_SCHEMA_VERSION = 1

export interface DiscordActivityHtmlExportOptions {
  fileSystem?: ExclusivePrivateFileSystem
}

export interface DiscordActivityHtmlExportReport {
  activityRecordsCreated: false
  activityStateChanged: false
  automaticNetwork: "disabled"
  browserOpened: false
  bytes: number
  credentialsEmbedded: false
  credentialsRequired: false
  discordContacted: false
  externalNavigationOrigins: readonly []
  file: string
  format: typeof ACTIVITY_HTML_FORMAT
  htmlDigest: string
  outputFileCreated: true
  reportDigest: string
  schemaVersion: typeof ACTIVITY_HTML_SCHEMA_VERSION
  statePersistence: "disabled"
  status: "ok"
}

const ACTIVITY_HTML_FILE_MESSAGES = Object.freeze({
  exists: "Activity HTML target already exists; choose a new path or move the existing file",
  failure: "Activity HTML export could not be written",
  invalidPath: "Activity HTML export requires a valid file path",
})

const ACTIVITY_SCRIPT = `(function () {
  'use strict';
  const cards = Array.from(document.querySelectorAll('[data-record]'));
  const buttons = Array.from(document.querySelectorAll('[data-disposition-filter]'));
  const kind = document.getElementById('kind-filter');
  const search = document.getElementById('activity-search');
  const result = document.getElementById('filter-result');
  const empty = document.getElementById('filter-empty');
  const main = document.getElementById('main');
  const copyStatus = document.getElementById('copy-status');
  const skip = document.querySelector('.skip-link');
  let disposition = 'all';
  const apply = () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    cards.forEach((card) => {
      const matchesDisposition = disposition === 'all' || card.dataset.disposition === disposition;
      const matchesKind = kind.value === 'all' || card.dataset.kind === kind.value;
      const matchesSearch = query.length === 0 || (card.dataset.search || '').includes(query);
      const show = matchesDisposition && matchesKind && matchesSearch;
      card.hidden = !show;
      if (show) visible += 1;
    });
    result.textContent = visible + ' of ' + cards.length + ' records shown';
    empty.hidden = visible !== 0;
  };
  buttons.forEach((button) => button.addEventListener('click', () => {
    disposition = button.dataset.dispositionFilter || 'all';
    buttons.forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)));
    apply();
  }));
  kind.addEventListener('change', apply);
  search.addEventListener('input', apply);
  skip.addEventListener('click', (event) => {
    event.preventDefault();
    main.focus();
    main.scrollIntoView();
  });
  document.addEventListener('click', async (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('[data-copy-target]');
    if (!button) return;
    const source = document.getElementById(button.dataset.copyTarget || '');
    if (!source) return;
    const value = source.textContent || '';
    let copied = false;
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch {
      const selection = getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(source);
        selection.removeAllRanges();
        selection.addRange(range);
        copied = document.execCommand('copy');
        selection.removeAllRanges();
      }
    }
    copyStatus.textContent = copied ? 'Copied ' + button.dataset.copyLabel : 'Copy was unavailable; select the visible value manually';
  });
  apply();
})();`

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function digest(value: string, encoding: "base64" | "hex" = "hex"): string {
  return createHash("sha256").update(value).digest(encoding)
}

function countFor(counts: readonly ActivityReviewCount[], value: string): number {
  return counts.find((entry) => entry.value === value)?.count || 0
}

function copyButton(target: string, label: string): string {
  return `<button type="button" class="copy" data-copy-target="${escapeHtml(target)}" data-copy-label="${escapeHtml(label)}">Copy</button>`
}

function recordMarkup(record: ActivityReviewRecord, index: number): string {
  const idTarget = `activity-id-${index}`
  const claims = record.claimIds.length === 0
    ? `<span class="muted">No recent claim correlation</span>`
    : record.claimIds.map((claimId) => `<code>${escapeHtml(claimId)}</code>`).join(" ")
  const error = record.entry.error
    ? `<span class="signal"><strong>Error</strong> <code>${escapeHtml(record.entry.error)}</code></span>`
    : ""
  const verification = "verification" in record.entry && record.entry.verification
    ? `<span class="signal"><strong>Verification</strong> <code>${escapeHtml(record.entry.verification)}</code></span>`
    : ""
  const search = escapeHtml(JSON.stringify({
    claims: record.claimIds,
    disposition: record.disposition,
    entry: record.entry,
  }).toLowerCase())
  return `<article class="event disposition-${record.disposition}" data-record data-disposition="${record.disposition}" data-kind="${escapeHtml(record.entry.kind)}" data-search="${search}">
    <div class="event-head">
      <div><p class="timestamp">${escapeHtml(record.entry.timestamp)}</p><h3>${escapeHtml(record.entry.kind)}</h3></div>
      <div class="badges"><span class="badge">${escapeHtml(record.entry.status)}</span><span class="badge disposition">${record.disposition}</span>${record.current ? "" : `<span class="badge">history</span>`}</div>
    </div>
    <div class="identity"><span><strong>Activity ID</strong><br><code id="${idTarget}">${escapeHtml(record.entry.id)}</code></span>${copyButton(idTarget, "activity ID")}</div>
    <p class="guidance">${escapeHtml(record.guidance)}</p>
    <div class="signals">${error}${verification}</div>
    <div class="claims"><strong>Correlated claims</strong><div>${claims}</div></div>
    <details><summary>Exact content-free record</summary><pre tabindex="0"><code>${escapeHtml(JSON.stringify(record.entry, null, 2))}</code></pre></details>
  </article>`
}

function targetLabel(claim: WriteCoordinationClaimStatus): string {
  return claim.targets.map((target) => {
    if (target.kind === "application-collection") {
      return `application ${target.applicationId} / ${target.collection}`
    }
    if (target.kind === "guild-collection") {
      return `guild ${target.guildId} / ${target.collection}`
    }
    return `${target.kind} ${target.id}`
  }).join(", ")
}

function claimMarkup(
  claim: WriteCoordinationClaimStatus,
  index: number,
  unmatched: boolean,
): string {
  const idTarget = `claim-id-${index}`
  return `<article class="claim claim-${claim.state}">
    <div class="event-head"><div><p class="timestamp">${escapeHtml(claim.createdAt)}</p><h3>${escapeHtml(claim.kind)}</h3></div><div class="badges"><span class="badge disposition">${escapeHtml(claim.state)}</span>${unmatched ? `<span class="badge">no recent activity</span>` : ""}</div></div>
    <div class="identity"><span><strong>Claim ID</strong><br><code id="${idTarget}">${escapeHtml(claim.claimId)}</code></span>${copyButton(idTarget, "claim ID")}</div>
    <dl><div><dt>Owner</dt><dd>${escapeHtml(claim.ownerState)} / PID ${claim.ownerPid}</dd></div><div><dt>Receipt</dt><dd>${escapeHtml(claim.receiptState)}</dd></div><div><dt>Published targets</dt><dd>${claim.publishedTargetCount}</dd></div></dl>
    <p class="target"><strong>Exact targets</strong><br>${escapeHtml(targetLabel(claim))}</p>
    ${claim.state === "review-required" ? `<p class="guidance"><strong>Operator review required.</strong> Stop the owner, inspect the exact Discord state and audit log, then use the separate coordination command with exact confirmation. This page cannot resolve the claim.</p>` : `<p class="guidance">${claim.state === "active" ? "The owning process is alive. Do not interfere with or retry its operation." : "A later writer may reclaim this claim only through existing safe receipt evidence."}</p>`}
    <details><summary>Exact content-free claim</summary><pre tabindex="0"><code>${escapeHtml(JSON.stringify(claim, null, 2))}</code></pre></details>
  </article>`
}

function kindOptions(report: DiscordActivityReviewReport): string {
  const kinds = [...new Set(report.records.map(({ entry }) => entry.kind))].sort()
  return kinds.map((kind) => `<option value="${escapeHtml(kind)}">${escapeHtml(kind)}</option>`).join("")
}

export function renderDiscordActivityHtml(
  report: DiscordActivityReviewReport,
): string {
  if (!verifyDiscordActivityReviewReport(report)) {
    throw new ConfigurationError("Activity HTML export requires an exact activity-review report")
  }
  const scriptHash = digest(ACTIVITY_SCRIPT, "base64")
  const records = report.records.map(recordMarkup).join("")
  const unmatchedClaimIds = new Set(report.unmatchedClaimIds)
  const claims = report.claims
    .map((claim, index) => claimMarkup(claim, index, unmatchedClaimIds.has(claim.claimId)))
    .join("")
  const exactReport = escapeHtml(JSON.stringify(report, null, 2))
  const pending = countFor(report.summary.dispositions, "pending")
  const uncertain = countFor(report.summary.dispositions, "uncertain")
  const review = countFor(report.summary.dispositions, "review")
  const settled = countFor(report.summary.dispositions, "settled")
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; img-src 'none'; manifest-src 'none'; media-src 'none'; object-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; worker-src 'none'; require-trusted-types-for 'script'">
  <meta name="description" content="Private content-free GuildControl MCP activity review">
  <title>GuildControl MCP activity review: ${report.outcome}</title>
  <style>
    :root{--bg:#f3f5f9;--panel:#fff;--panel-2:#f8f9fc;--ink:#182033;--muted:#5a6478;--line:#d9deea;--brand:#4455d8;--action:#3b46bf;--good:#087b61;--warn:#9a5700;--danger:#b52d45;--pending:#8a4b00;--focus:#b94b00;--shadow:0 18px 50px rgba(34,44,72,.1)}
    @media(prefers-color-scheme:dark){:root{--bg:#0c111b;--panel:#151c29;--panel-2:#101724;--ink:#eff2ff;--muted:#aab4c8;--line:#313a4c;--brand:#8d97ff;--action:#3b46bf;--good:#67d5b6;--warn:#ffc06d;--danger:#ff8798;--pending:#ffc06d;--focus:#ffd166;--shadow:0 18px 50px rgba(0,0,0,.32)}}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55}.shell{width:min(1160px,calc(100% - 2rem));margin:0 auto}.skip-link{position:fixed;left:1rem;top:-5rem;z-index:30;padding:.7rem 1rem;border:2px solid var(--focus);border-radius:.7rem;background:var(--panel);color:var(--ink)}.skip-link:focus{top:1rem}.hero{padding:4.5rem 0 2rem}.eyebrow{margin:0 0 .6rem;color:var(--brand);font-size:.76rem;font-weight:850;letter-spacing:.14em;text-transform:uppercase}.hero h1{max-width:900px;margin:0;font-size:clamp(2.5rem,7vw,5.8rem);line-height:.94;letter-spacing:-.058em}.lede{max-width:800px;margin:1.3rem 0 0;color:var(--muted);font-size:clamp(1rem,2vw,1.2rem)}.proofs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin:2rem 0}.proof{min-width:0;padding:1rem;border:1px solid var(--line);border-radius:1rem;background:var(--panel);box-shadow:var(--shadow)}.proof strong{display:block;overflow-wrap:anywhere;font-size:1.15rem}.proof span{color:var(--muted);font-size:.78rem}.boundary{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:1rem 0}.panel{min-width:0;padding:1.2rem;border:1px solid var(--line);border-radius:1rem;background:var(--panel);box-shadow:var(--shadow)}.panel h2{margin-top:0}.checks{display:grid;grid-template-columns:1fr 1fr;gap:.55rem;margin:0;padding:0;list-style:none}.checks li{padding:.7rem;border-radius:.7rem;background:var(--panel-2)}.checks li::before{content:"OK";display:inline-block;margin-right:.45rem;color:var(--good);font-size:.66rem;font-weight:900}.warning{border-left:4px solid var(--warn)}.danger{border-left:4px solid var(--danger)}.muted{color:var(--muted)}.digest{overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.74rem;color:var(--muted)}.sticky{position:sticky;top:0;z-index:10;border-block:1px solid var(--line);background:color-mix(in srgb,var(--bg) 91%,transparent);backdrop-filter:blur(14px)}.filters{display:grid;grid-template-columns:minmax(14rem,1fr) minmax(10rem,.45fr);gap:.75rem;padding:.75rem 0}.filters label{display:grid;gap:.3rem;color:var(--muted);font-size:.73rem;font-weight:800;text-transform:uppercase}.filters input,.filters select{min-width:0;min-height:2.7rem;padding:.58rem .7rem;border:1px solid var(--line);border-radius:.65rem;background:var(--panel);color:var(--ink);font:inherit;text-transform:none}.filter-buttons{display:flex;gap:.45rem;overflow:auto;padding:0 0 .75rem}.filter-buttons button,.copy{min-height:2.35rem;padding:.45rem .7rem;border:1px solid var(--line);border-radius:.65rem;background:var(--panel);color:var(--ink);font:inherit;font-size:.78rem;font-weight:800;cursor:pointer;white-space:nowrap}.filter-buttons button[aria-pressed="true"]{background:var(--action);border-color:var(--action);color:#fff}.copy:hover,.filter-buttons button:hover{border-color:var(--brand);color:var(--brand)}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible,pre:focus-visible{outline:3px solid var(--focus);outline-offset:2px}main{padding:2rem 0 4rem;scroll-margin-top:9rem}.section-head{display:flex;align-items:end;justify-content:space-between;gap:1rem;margin:2rem 0 1rem}.section-head h2{margin:0;font-size:clamp(1.6rem,4vw,2.5rem);letter-spacing:-.035em}.section-head p{margin:0;color:var(--muted)}.timeline{display:grid;gap:1rem}.event,.claim{min-width:0;padding:1.2rem;border:1px solid var(--line);border-left:5px solid var(--good);border-radius:1rem;background:var(--panel);box-shadow:var(--shadow)}.event.disposition-pending{border-left-color:var(--pending)}.event.disposition-review,.claim-review-required{border-left-color:var(--danger)}.event.disposition-uncertain{border-left-color:var(--danger)}.event.disposition-superseded{border-left-color:var(--line);background:var(--panel-2)}.claim-active{border-left-color:var(--pending)}.claim-auto-reclaimable{border-left-color:var(--good)}.event-head{display:flex;align-items:start;justify-content:space-between;gap:1rem}.timestamp{margin:0;color:var(--muted);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.75rem}.event h3,.claim h3{margin:.2rem 0 0;font-size:1.3rem}.badges{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.4rem}.badge{padding:.28rem .5rem;border:1px solid var(--line);border-radius:999px;background:var(--panel-2);font-size:.7rem;font-weight:850}.badge.disposition{color:var(--brand)}.identity{display:flex;align-items:center;justify-content:space-between;gap:.8rem;margin:1rem 0;padding:.8rem;border:1px solid var(--line);border-radius:.75rem;background:var(--panel-2)}.identity code,.claims code{overflow-wrap:anywhere}.guidance{padding:.75rem .85rem;border-radius:.7rem;background:var(--panel-2)}.signals{display:flex;flex-wrap:wrap;gap:.5rem}.signal{padding:.4rem .55rem;border:1px solid var(--line);border-radius:.6rem}.claims{margin:.8rem 0}.claims>div{display:flex;flex-wrap:wrap;gap:.45rem;margin-top:.35rem}.event details,.claim details,.evidence{margin-top:.8rem;border:1px solid var(--line);border-radius:.75rem;background:var(--panel-2)}summary{padding:.8rem;cursor:pointer;font-weight:800}pre{max-height:28rem;overflow:auto;margin:0;padding:0 .8rem .8rem;font-size:.74rem;line-height:1.45}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.6rem}dl div{padding:.65rem;border-radius:.65rem;background:var(--panel-2)}dt{color:var(--muted);font-size:.68rem;font-weight:850;text-transform:uppercase}dd{margin:.2rem 0 0;overflow-wrap:anywhere}.target{overflow-wrap:anywhere}.claims-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.empty{padding:2rem;border:1px dashed var(--line);border-radius:1rem;text-align:center;color:var(--muted)}.status{min-height:1.5rem;color:var(--good);font-size:.83rem}.evidence{padding:0;background:var(--panel)}.evidence pre{padding:0 1rem 1rem}.footer{padding:2rem 0 4rem;border-top:1px solid var(--line);color:var(--muted);font-size:.82rem}
    @media(max-width:820px){.proofs{grid-template-columns:repeat(2,minmax(0,1fr))}.boundary,.claims-grid{grid-template-columns:minmax(0,1fr)}.checks{grid-template-columns:minmax(0,1fr)}dl{grid-template-columns:minmax(0,1fr)}}
    @media(max-width:560px){.shell{width:min(100% - 1rem,1160px)}.hero{padding-top:2.8rem}.proofs{grid-template-columns:minmax(0,1fr)}.filters{grid-template-columns:minmax(0,1fr)}.event-head,.section-head,.identity{align-items:stretch;flex-direction:column}.badges{justify-content:flex-start}.copy{align-self:flex-start}}
    @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
  </style>
</head>
<body>
  <a class="skip-link" href="#main">Skip to activity</a>
  <header class="shell hero">
    <p class="eyebrow">Private local operations review</p>
    <h1>Know what settled. Stop where certainty ends.</h1>
    <p class="lede">This digest-bound report joins recent content-free write lifecycles to durable coordination claims. It explains what needs attention without reading a credential, contacting Discord, resolving state, or hiding superseded evidence.</p>
    <div class="proofs" role="list" aria-label="Review summary">
      <div class="proof" role="listitem"><strong>${report.summary.currentActivities}</strong><span>Current activity lifecycles</span></div>
      <div class="proof" role="listitem"><strong>${report.summary.attentionActivities}</strong><span>Activities needing attention</span></div>
      <div class="proof" role="listitem"><strong>${report.claims.length}</strong><span>Durable claims / ${report.summary.unmatchedClaims} without recent activity</span></div>
      <div class="proof" role="listitem"><strong>${report.skippedLines}</strong><span>Skipped recent lines</span></div>
    </div>
    <div class="boundary">
      <section class="panel" aria-labelledby="boundary-title"><h2 id="boundary-title">Privacy boundary</h2><ul class="checks"><li>No credentials or local paths</li><li>No message content or attachments</li><li>No Discord names or audit reasons</li><li>No network, telemetry, or browser storage</li><li>No claim resolution or retry</li><li>Independent reads, not a global state lock</li></ul></section>
      <section class="panel ${report.outcome === "attention" ? "warning" : ""}" aria-labelledby="outcome-title"><h2 id="outcome-title">Snapshot outcome: ${report.outcome}</h2><p>${report.outcome === "attention" ? "Review every highlighted current lifecycle and any review-required claim. Do not retry an uncertain operation." : "Every current lifecycle in this bounded recent window is settled and no review-required claim or malformed recent line was found."}</p><p><strong>Current dispositions</strong><br>Settled ${settled} / Pending ${pending} / Review ${review} / Uncertain ${uncertain}</p><p class="digest">${escapeHtml(report.reportDigest)}</p></section>
    </div>
    ${report.skippedLines > 0 ? `<p class="panel danger"><strong>Recent input was skipped.</strong> ${report.skippedLines} non-empty line${report.skippedLines === 1 ? "" : "s"} in the bounded read window failed the strict content-free schema. Treat the review as incomplete and inspect the private journal before relying on it.</p>` : ""}
  </header>
  <div class="sticky" role="search" aria-label="Activity filters">
    <div class="shell filters">
      <label>Search exact evidence<input id="activity-search" type="search" autocomplete="off" placeholder="Activity ID, Discord ID, status, hash"></label>
      <label>Activity kind<select id="kind-filter"><option value="all">All kinds</option>${kindOptions(report)}</select></label>
    </div>
    <div class="shell filter-buttons" role="group" aria-label="Disposition filters">
      <button type="button" data-disposition-filter="all" aria-pressed="true">All</button>
      <button type="button" data-disposition-filter="pending" aria-pressed="false">Pending</button>
      <button type="button" data-disposition-filter="review" aria-pressed="false">Review</button>
      <button type="button" data-disposition-filter="uncertain" aria-pressed="false">Uncertain</button>
      <button type="button" data-disposition-filter="settled" aria-pressed="false">Settled</button>
      <button type="button" data-disposition-filter="superseded" aria-pressed="false">History</button>
    </div>
  </div>
  <main id="main" class="shell" tabindex="-1">
    <section aria-labelledby="timeline-title"><div class="section-head"><div><p class="eyebrow">Newest first</p><h2 id="timeline-title">Activity timeline</h2></div><p id="filter-result" role="status" aria-live="polite">${report.records.length} of ${report.records.length} records shown</p></div><div class="timeline">${records}</div><p id="filter-empty" class="empty" hidden>No activity records match these filters.</p>${report.records.length === 0 ? `<p class="empty">No content-free write activity exists in this recent window.</p>` : ""}</section>
    <section aria-labelledby="claims-title"><div class="section-head"><div><p class="eyebrow">Cross-process state</p><h2 id="claims-title">Durable claims</h2></div><p>${report.summary.reviewRequiredClaims} require operator review</p></div>${report.claims.length > 0 ? `<div class="claims-grid">${claims}</div>` : `<p class="empty">No durable write claim is published for this policy.</p>`}</section>
    <section aria-labelledby="evidence-title"><div class="section-head"><div><p class="eyebrow">Digest-bound snapshot</p><h2 id="evidence-title">Complete review evidence</h2></div><p>Connector ${escapeHtml(CONNECTOR_VERSION)} / ${ACTIVITY_HTML_FORMAT}</p></div><details class="evidence"><summary>Inspect exact report JSON</summary><pre tabindex="0"><code>${exactReport}</code></pre></details></section>
    <p id="copy-status" class="status" role="status" aria-live="polite"></p>
  </main>
  <footer class="footer"><div class="shell"><p>This private artifact contains exact Discord identifiers, activity identifiers, digests, and local process evidence. Review before sharing. It contains no Discord content or credential and cannot contact or change Discord.</p><p class="digest">${escapeHtml(report.reportDigest)}</p></div></footer>
  <script>${ACTIVITY_SCRIPT}</script>
</body>
</html>
`
}

export async function exportDiscordActivityHtml(
  file: string,
  report: DiscordActivityReviewReport,
  options: DiscordActivityHtmlExportOptions = {},
): Promise<DiscordActivityHtmlExportReport> {
  const target = resolveExclusivePrivateFile(file, ACTIVITY_HTML_FILE_MESSAGES)
  const content = renderDiscordActivityHtml(report)
  await writeExclusivePrivateFile(
    target,
    content,
    ACTIVITY_HTML_FILE_MESSAGES,
    options.fileSystem,
  )
  return {
    activityRecordsCreated: false,
    activityStateChanged: false,
    automaticNetwork: "disabled",
    browserOpened: false,
    bytes: Buffer.byteLength(content),
    credentialsEmbedded: false,
    credentialsRequired: false,
    discordContacted: false,
    externalNavigationOrigins: Object.freeze([]),
    file: target,
    format: ACTIVITY_HTML_FORMAT,
    htmlDigest: `sha256:${digest(content)}`,
    outputFileCreated: true,
    reportDigest: report.reportDigest,
    schemaVersion: ACTIVITY_HTML_SCHEMA_VERSION,
    statePersistence: "disabled",
    status: "ok",
  }
}
