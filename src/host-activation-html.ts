import { createHash } from "node:crypto"
import { isAbsolute } from "node:path"

import { CONNECTOR_VERSION } from "./constants.js"
import { ConfigurationError } from "./errors.js"
import {
  resolveExclusivePrivateFile,
  writeExclusivePrivateFile,
  type ExclusivePrivateFileSystem,
} from "./exclusive-private-file.js"
import {
  verifyHostActivationPlan,
  type HostActivationPlan,
} from "./host-activation.js"
import {
  createHostAdapterCatalog,
  type HostAdapter,
} from "./host-adapters.js"

export const HOST_ACTIVATION_HTML_FORMAT = "guildcontrol.host-activation-html.v2"
export const HOST_ACTIVATION_HTML_SCHEMA_VERSION = 2

export interface DiscordHostActivationHtmlExportOptions {
  fileSystem?: ExclusivePrivateFileSystem
}

export interface DiscordHostActivationHtmlExportReport {
  activationDigest: string
  adapterDigests: readonly string[]
  adapterIds: readonly string[]
  automaticNetwork: "disabled"
  browserOpened: false
  bytes: number
  credentialValuesEmbedded: false
  credentialValuesRead: false
  discordContacted: false
  externalNavigationOrigins: readonly []
  file: string
  format: typeof HOST_ACTIVATION_HTML_FORMAT
  hostConfigurationChanged: false
  hostDiscovered: false
  htmlDigest: string
  identifiersEmbedded: true
  localPathsEmbedded: boolean
  outputFileCreated: true
  processStarted: false
  runtimeCredentialsRequired: true
  schemaVersion: typeof HOST_ACTIVATION_HTML_SCHEMA_VERSION
  statePersistence: "disabled"
  status: "ok"
}

const HOST_ACTIVATION_HTML_FILE_MESSAGES = Object.freeze({
  exists: "Host activation HTML target already exists; choose a new path or move the existing file",
  failure: "Host activation HTML export could not be written",
  invalidPath: "Host activation HTML export requires a valid file path",
})

const HOST_ACTIVATION_SCRIPT = `(function () {
  'use strict';
  const checks = Array.from(document.querySelectorAll('[data-step]'));
  const progress = document.getElementById('activation-progress');
  const progressText = document.getElementById('progress-text');
  const copyStatus = document.getElementById('copy-status');
  const main = document.getElementById('main');
  const skip = document.querySelector('.skip-link');
  const update = () => {
    const complete = checks.filter((entry) => entry.checked).length;
    progress.max = checks.length;
    progress.value = complete;
    progressText.textContent = complete + ' of ' + checks.length + ' checks completed';
  };
  checks.forEach((entry) => entry.addEventListener('change', update));
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
  update();
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

function copyButton(target: string, label: string): string {
  const accessibleLabel = `Copy ${label}`
  return `<button type="button" class="copy" data-copy-target="${escapeHtml(target)}" data-copy-label="${escapeHtml(label)}" aria-label="${escapeHtml(accessibleLabel)}" title="${escapeHtml(accessibleLabel)}">Copy</button>`
}

function valueList(values: readonly string[], empty: string): string {
  return values.length === 0
    ? `<span class="muted">${escapeHtml(empty)}</span>`
    : values.map((value) => `<code>${escapeHtml(value)}</code>`).join(" ")
}

function smokeDescriptor(plan: HostActivationPlan): string {
  const args = [...plan.launch.args]
  args[args.length - 3] = "smoke"
  return JSON.stringify({
    args,
    command: plan.launch.command,
  }, null, 2)
}

function textList(values: readonly string[]): string {
  return `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`
}

function renderHostAdapter(adapter: HostAdapter): string {
  const contentId = `adapter-content-${adapter.id}`
  const formatLabel = adapter.format.toUpperCase()
  const contentLabel = adapter.title.toUpperCase().endsWith(formatLabel)
    ? adapter.title
    : `${adapter.title} ${formatLabel}`
  const uriId = `adapter-uri-${adapter.id}`
  return `<article class="adapter" role="listitem" aria-labelledby="adapter-title-${adapter.id}">
    <div class="adapter-head"><div><p class="adapter-kicker">${escapeHtml(adapter.id)}</p><h3 id="adapter-title-${adapter.id}">${escapeHtml(adapter.title)}</h3></div><div class="tokens"><code>${escapeHtml(adapter.secret.strategy)}</code><code>${escapeHtml(adapter.hostServerName)}</code></div></div>
    <p class="digest">${escapeHtml(adapter.adapterDigest)}</p>
    <div class="adapter-meta"><div><span class="field-label">Destinations</span>${textList(adapter.destinations)}</div><div><span class="field-label">Credential environment names</span><div class="tokens">${valueList(adapter.secret.environmentVariables, "none; existing credential file")}</div></div></div>
    <details open><summary>Exact ${escapeHtml(adapter.format.toUpperCase())}</summary><div class="value-row"><pre id="${contentId}" tabindex="0"><code>${escapeHtml(adapter.content)}</code></pre>${copyButton(contentId, contentLabel)}</div></details>
    ${adapter.installUri ? `<div class="field install-uri"><span class="field-label">Private install URI</span><div class="value-row"><code id="${uriId}">${escapeHtml(adapter.installUri)}</code>${copyButton(uriId, `${adapter.title} install URI`)}</div><p class="muted">Review this encoded policy-specific handoff before pasting it into an address field. It is text, not an active link.</p></div>` : ""}
    <div class="adapter-guidance"><div><h4>Use it safely</h4>${textList(adapter.instructions)}</div><div><h4>What it does not prove</h4>${textList(adapter.limitations)}</div></div>
    <p class="source"><strong>Official schema source:</strong> ${escapeHtml(adapter.specification.title)} <code>${escapeHtml(adapter.specification.url)}</code></p>
  </article>`
}

export function renderDiscordHostActivationHtml(
  plan: HostActivationPlan,
): string {
  if (!verifyHostActivationPlan(plan)) {
    throw new ConfigurationError("Host activation HTML requires an exact credential-free plan")
  }
  const adapterCatalog = createHostAdapterCatalog(plan)
  const scriptHash = digest(HOST_ACTIVATION_SCRIPT, "base64")
  const descriptor = JSON.stringify(plan.launch, null, 2)
  const exactPlan = JSON.stringify(plan, null, 2)
  const exactAdapterCatalog = JSON.stringify(adapterCatalog, null, 2)
  const source = plan.policy.source.kind === "config"
    ? `Configuration file ${plan.policy.source.file}`
    : `Managed profile ${plan.policy.source.name}`
  const environmentSet = JSON.stringify(plan.launch.environment.set, null, 2)
  const argumentsJson = JSON.stringify(plan.launch.args, null, 2)
  const forwardJson = JSON.stringify(plan.launch.environment.forward, null, 2)
  const secretFilesJson = JSON.stringify(plan.launch.secrets.files, null, 2)
  return `<!doctype html>
<html lang="en" data-format="${HOST_ACTIVATION_HTML_FORMAT}" data-schema-version="${HOST_ACTIVATION_HTML_SCHEMA_VERSION}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; img-src 'none'; manifest-src 'none'; media-src 'none'; object-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; worker-src 'none'; require-trusted-types-for 'script'">
  <meta name="description" content="Private credential-free GuildControl MCP host activation guide">
  <title>GuildControl MCP host activation: ${escapeHtml(plan.policy.name)}</title>
  <style>
    :root{--bg:#f4f6fb;--panel:#fff;--panel-2:#f7f8fc;--ink:#172035;--muted:#5d687d;--line:#d9deea;--brand:#5864e8;--brand-2:#3845bc;--action:#3d49c8;--good:#087b61;--warn:#9b5800;--focus:#b64a00;--shadow:0 18px 52px rgba(39,48,80,.1)}
    @media(prefers-color-scheme:dark){:root{--bg:#0b111c;--panel:#151d2b;--panel-2:#101825;--ink:#eef1ff;--muted:#aab4c9;--line:#313b4e;--brand:#98a1ff;--brand-2:#c0c5ff;--action:#4652d1;--good:#69d4b7;--warn:#ffc271;--focus:#ffd166;--shadow:0 18px 52px rgba(0,0,0,.34)}}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55}.shell{width:min(1120px,calc(100% - 2rem));margin:0 auto}.skip-link{position:fixed;left:1rem;top:-5rem;z-index:30;padding:.7rem 1rem;border:2px solid var(--focus);border-radius:.7rem;background:var(--panel);color:var(--ink)}.skip-link:focus{top:1rem}.hero{padding:4.5rem 0 2rem}.eyebrow{margin:0 0 .65rem;color:var(--brand-2);font-size:.76rem;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.hero h1{max-width:900px;margin:0;font-size:clamp(2.55rem,7vw,5.7rem);line-height:.94;letter-spacing:-.058em}.lede{max-width:820px;margin:1.3rem 0 0;color:var(--muted);font-size:clamp(1rem,2vw,1.2rem)}.proofs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin:2rem 0}.proof{min-width:0;padding:1rem;border:1px solid var(--line);border-radius:1rem;background:var(--panel);box-shadow:var(--shadow)}.proof strong{display:block;overflow-wrap:anywhere;font-size:1.08rem}.proof span{color:var(--muted);font-size:.78rem}.boundary{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.panel,.step{min-width:0;padding:1.2rem;border:1px solid var(--line);border-radius:1rem;background:var(--panel);box-shadow:var(--shadow)}.panel h2,.step h2{margin-top:0}.private{border-left:5px solid var(--warn)}.checks{display:grid;grid-template-columns:1fr 1fr;gap:.55rem;margin:0;padding:0;list-style:none}.checks li{padding:.7rem;border-radius:.7rem;background:var(--panel-2)}.checks li::before{content:"NO";display:inline-block;margin-right:.45rem;color:var(--warn);font-size:.66rem;font-weight:900}.digest{overflow-wrap:anywhere;color:var(--muted);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.73rem}.sticky{position:sticky;top:0;z-index:10;border-block:1px solid var(--line);background:var(--bg)}.progress-row{display:grid;grid-template-columns:auto minmax(10rem,1fr) auto;align-items:center;gap:1rem;padding:.75rem 0}.progress-row strong{white-space:nowrap}.progress-row span{color:var(--muted);font-size:.82rem}progress{width:100%;height:.65rem;border:0;border-radius:999px;overflow:hidden;background:var(--line)}progress::-webkit-progress-bar{background:var(--line)}progress::-webkit-progress-value{background:linear-gradient(90deg,var(--brand),var(--brand-2))}progress::-moz-progress-bar{background:linear-gradient(90deg,var(--brand),var(--brand-2))}main{display:grid;gap:1rem;padding:2rem 0 4rem;scroll-margin-top:6rem}.step-head{display:flex;align-items:start;justify-content:space-between;gap:1rem}.step-head p{margin:.35rem 0 0;color:var(--muted)}.done{display:flex;align-items:center;gap:.45rem;padding:.45rem .65rem;border:1px solid var(--line);border-radius:.65rem;color:var(--muted);font-size:.78rem;font-weight:850;white-space:nowrap}.done input{width:1.05rem;height:1.05rem;margin:0;accent-color:var(--brand)}.step-body{margin-top:1rem;padding-top:1rem;border-top:1px solid var(--line)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.field{min-width:0;padding:.9rem;border:1px solid var(--line);border-radius:.8rem;background:var(--panel-2)}.field-label{display:block;margin-bottom:.35rem;color:var(--muted);font-size:.68rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.value-row{display:flex;align-items:center;justify-content:space-between;gap:.7rem}.value-row code{min-width:0;overflow-wrap:anywhere}.copy{min-height:2.4rem;padding:.45rem .72rem;border:1px solid var(--line);border-radius:.65rem;background:var(--panel);color:var(--ink);font:inherit;font-size:.78rem;font-weight:850;cursor:pointer;white-space:nowrap}.copy:hover{border-color:var(--brand);color:var(--brand-2)}button:focus-visible,input:focus-visible,summary:focus-visible,pre:focus-visible{outline:3px solid var(--focus);outline-offset:2px}.tokens{display:flex;flex-wrap:wrap;gap:.4rem}.tokens code{padding:.25rem .45rem;border:1px solid var(--line);border-radius:.45rem;background:var(--panel)}.muted{color:var(--muted)}table{width:100%;border-collapse:collapse;margin-top:.75rem;font-size:.9rem}th,td{padding:.7rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--muted);font-size:.7rem;letter-spacing:.07em;text-transform:uppercase}details{margin-top:.8rem;border:1px solid var(--line);border-radius:.75rem;background:var(--panel-2)}summary{padding:.8rem;cursor:pointer;font-weight:850}pre{max-height:30rem;overflow:auto;margin:0;padding:0 .8rem .8rem;font-size:.74rem;line-height:1.45}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.callout{padding:.8rem .9rem;border-left:4px solid var(--brand);border-radius:.35rem .7rem .7rem .35rem;background:var(--panel-2)}.callout.private{border-left-color:var(--warn)}.prompt{display:flex;align-items:start;justify-content:space-between;gap:.8rem;padding:1rem;border:1px solid var(--line);border-radius:.8rem;background:var(--panel-2)}.prompt code{white-space:pre-wrap;overflow-wrap:anywhere}.adapter-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.adapter{min-width:0;padding:1rem;border:1px solid var(--line);border-radius:1rem;background:var(--panel-2)}.adapter-head{display:flex;align-items:start;justify-content:space-between;gap:.8rem}.adapter h3{margin:0;font-size:1.35rem}.adapter h4{margin:0 0 .4rem}.adapter-kicker{margin:0;color:var(--brand-2);font-size:.68rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.adapter-meta,.adapter-guidance{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.adapter-meta>div,.adapter-guidance>div{min-width:0}.adapter ul{margin:.35rem 0 0;padding-left:1.25rem}.adapter li+li{margin-top:.35rem}.adapter pre{min-height:12rem}.install-uri{margin-top:.8rem}.source{overflow-wrap:anywhere;color:var(--muted);font-size:.78rem}.source code{white-space:normal}.status{min-height:1.5rem;color:var(--good);font-size:.83rem}.footer{padding:2rem 0 4rem;border-top:1px solid var(--line);color:var(--muted);font-size:.82rem}
    @media(max-width:820px){.proofs{grid-template-columns:repeat(2,minmax(0,1fr))}.boundary,.grid,.adapter-grid{grid-template-columns:minmax(0,1fr)}.checks{grid-template-columns:minmax(0,1fr)}.step-head{align-items:stretch;flex-direction:column}.done{align-self:flex-start}.progress-row{grid-template-columns:1fr auto}.progress-row strong{grid-column:1/-1}}
    @media(max-width:520px){.shell{width:min(100% - 1rem,1120px)}.hero{padding-top:2.7rem}.sticky{position:static}.proofs{grid-template-columns:minmax(0,1fr)}main{scroll-margin-top:1rem}.step{padding:1rem}.value-row,.prompt,.adapter-head{align-items:stretch;flex-direction:column}.adapter-meta,.adapter-guidance{grid-template-columns:minmax(0,1fr)}.copy{align-self:flex-start}.progress-row{gap:.55rem}}
    @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
  </style>
</head>
<body>
  <a class="skip-link" href="#main">Skip to activation</a>
  <header class="shell hero">
    <p class="eyebrow">Private host activation</p>
    <h1>Map the contract. Keep custody.</h1>
    <p class="lede">This credential-free artifact turns one verified GuildControl MCP policy into an exact local stdio handoff and digest-bound host projections. It supplies copyable schemas without writing host configuration or putting a bot token in this page.</p>
    <div class="proofs" role="list" aria-label="Activation evidence">
      <div class="proof" role="listitem"><strong>${escapeHtml(plan.launch.transport)}</strong><span>Local MCP transport</span></div>
      <div class="proof" role="listitem"><strong>${escapeHtml(plan.launch.serverName)}</strong><span>Portable server label</span></div>
      <div class="proof" role="listitem"><strong>${escapeHtml(plan.policy.tools.surface)}</strong><span>Tool discovery surface</span></div>
      <div class="proof" role="listitem"><strong>${escapeHtml(CONNECTOR_VERSION)}</strong><span>Connector version</span></div>
    </div>
    <div class="boundary">
      <section class="panel private" aria-labelledby="privacy-title"><h2 id="privacy-title">Keep this file private</h2><p>It contains public application and bot IDs, private guild and channel IDs, an exact local policy selector, command arguments, and any secret-file paths. It contains no credential value, but it still does not belong in an issue, transcript, screenshot, or shared repository.</p><p class="digest">${escapeHtml(plan.activationDigest)}</p></section>
      <section class="panel" aria-labelledby="limits-title"><h2 id="limits-title">What this artifact cannot do</h2><ul class="checks"><li>Cannot discover or edit an MCP host</li><li>Cannot read a credential value</li><li>Cannot start a local process</li><li>Cannot contact Discord or another network</li><li>Cannot prove an installed host accepts a projection</li><li>Cannot prove a host approval interface</li></ul></section>
    </div>
  </header>
  <div class="sticky"><section class="shell progress-row" aria-label="Activation progress"><strong>Local activation checklist</strong><progress id="activation-progress" value="0" max="6" aria-label="Host activation progress"></progress><span id="progress-text" aria-live="polite">0 checks completed</span></section></div>
  <main id="main" class="shell" tabindex="-1">
    <section class="step" id="policy">
      <div class="step-head"><div><h2>1. Confirm the policy identity</h2><p>Make sure this is the exact bot and read boundary the host should load.</p></div><label class="done"><input type="checkbox" data-step autocomplete="off" aria-label="Confirm policy identity">Checked</label></div>
      <div class="step-body"><div class="grid">
        <div class="field"><span class="field-label">Policy</span><strong>${escapeHtml(plan.policy.name)}</strong><p class="muted">${escapeHtml(source)}</p></div>
        <div class="field"><span class="field-label">Pinned identity</span><div class="tokens"><code>${escapeHtml(plan.policy.identity.applicationId)}</code><code>${escapeHtml(plan.policy.identity.botId)}</code></div></div>
        <div class="field"><span class="field-label">Exact guild read scope</span><div class="tokens">${valueList(plan.policy.readScope.guildIds, "none")}</div></div>
        <div class="field"><span class="field-label">Exact channel read scope</span><div class="tokens">${valueList(plan.policy.readScope.channelIds, "inherits the exact guild boundary")}</div></div>
        <div class="field"><span class="field-label">Tool surface</span><strong>${escapeHtml(plan.policy.tools.surface)}</strong></div>
        <div class="field"><span class="field-label">Toolsets</span><div class="tokens">${valueList(plan.policy.tools.toolsets, "none")}</div></div>
      </div></div>
    </section>
    <section class="step" id="process">
      <div class="step-head"><div><h2>2. Map the local stdio process</h2><p>Copy values by meaning into the host's local MCP server fields. Preserve argument order.</p></div><label class="done"><input type="checkbox" data-step autocomplete="off" aria-label="Map local stdio process">Checked</label></div>
      <div class="step-body"><div class="grid">
        <div class="field"><span class="field-label">Server name</span><div class="value-row"><code id="server-name">${escapeHtml(plan.launch.serverName)}</code>${copyButton("server-name", "server name")}</div></div>
        <div class="field"><span class="field-label">Command</span><div class="value-row"><code id="launch-command">${escapeHtml(plan.launch.command)}</code>${copyButton("launch-command", "command")}</div></div>
      </div>
      <details open><summary>Ordered arguments</summary><div class="value-row"><pre id="launch-arguments" tabindex="0"><code>${escapeHtml(argumentsJson)}</code></pre>${copyButton("launch-arguments", "ordered arguments")}</div></details>
      <table><thead><tr><th>Meaning</th><th>Map this exact value</th><th>Boundary</th></tr></thead><tbody>
        <tr><td>Transport</td><td><code>stdio</code></td><td>Local child process only; do not translate to HTTP</td></tr>
        <tr><td>Required server</td><td><code>true</code></td><td>Treat startup failure as a failed integration, not an optional omission</td></tr>
        <tr><td>Write approval</td><td><code>writes</code></td><td>Require host approval for write-capable and destructive tools</td></tr>
        <tr><td>Elicitation</td><td><code>required-for-reviewed-writes</code></td><td>A host without elicitation may use reads and plans but must not execute reviewed writes</td></tr>
        <tr><td>Startup timeout</td><td><code>${plan.launch.timeouts.startupSeconds} seconds</code></td><td>Allow the local process to initialize before declaring failure</td></tr>
        <tr><td>Tool timeout</td><td><code>${plan.launch.timeouts.toolSeconds} seconds</code></td><td>Preserve bounded Discord reads and reviewed planning without an unbounded host wait</td></tr>
      </tbody></table>
      <details><summary>Complete portable descriptor</summary><div class="value-row"><pre id="launch-descriptor" tabindex="0"><code>${escapeHtml(descriptor)}</code></pre>${copyButton("launch-descriptor", "portable descriptor")}</div></details></div>
    </section>
    <section class="step" id="adapters">
      <div class="step-head"><div><h2>3. Choose one verified host projection</h2><p>Each artifact preserves this activation digest, exact command and argument order, named secret references, and the requirements its host schema cannot encode.</p></div><label class="done"><input type="checkbox" data-step autocomplete="off" aria-label="Choose a verified host projection">Checked</label></div>
      <div class="step-body"><div class="adapter-grid" role="list" aria-label="Verified host adapters">${adapterCatalog.adapters.map(renderHostAdapter).join("")}</div><p class="callout"><strong>Merge, do not overwrite.</strong> For a shared host file, merge only the selected server and input records and preserve every unrelated entry. A dedicated extension adapter uses one complete manifest. For supported static JSON, use <code>host plan</code> and <code>host apply</code> with the same activation selector, adapter, and one explicit destination to get freshness review, a recoverable backup, atomic publication, exact reread, and rollback. This generated page itself never inspects or edits the destination.</p></div>
    </section>
    <section class="step" id="secrets">
      <div class="step-head"><div><h2>4. Forward references, never values</h2><p>Store the credential in the host's protected facility or external launcher and forward only the named reference.</p></div><label class="done"><input type="checkbox" data-step autocomplete="off" aria-label="Configure secret forwarding">Checked</label></div>
      <div class="step-body"><div class="grid">
        <div class="field"><span class="field-label">Environment names to forward</span><div class="value-row"><pre id="environment-forward" tabindex="0"><code>${escapeHtml(forwardJson)}</code></pre>${copyButton("environment-forward", "environment names")}</div></div>
        <div class="field"><span class="field-label">Referenced secret files</span><div class="value-row"><pre id="secret-files" tabindex="0"><code>${escapeHtml(secretFilesJson)}</code></pre>${copyButton("secret-files", "secret file paths")}</div></div>
        <div class="field"><span class="field-label">Inline environment values</span><div class="value-row"><pre id="environment-set" tabindex="0"><code>${escapeHtml(environmentSet)}</code></pre>${copyButton("environment-set", "empty inline environment map")}</div><p class="muted">Must remain empty. Forward named secret references through the host instead.</p></div>
        <div class="field"><span class="field-label">Credential values in this page</span><strong>None</strong><p class="muted">Do not add one while translating the descriptor.</p></div>
      </div><p class="callout private"><strong>Do not paste a bot token into a static host file.</strong> Forward the exact environment name from protected process state or preserve access to the exact private secret file. The connector has no fallback token source.</p></div>
    </section>
    <section class="step" id="verify">
      <div class="step-head"><div><h2>5. Restart and verify without writing</h2><p>Reload the host, inspect its negotiated server, then use the exact read-only request below.</p></div><label class="done"><input type="checkbox" data-step autocomplete="off" aria-label="Verify activated host">Checked</label></div>
      <div class="step-body"><div class="prompt"><code id="verification-prompt">${escapeHtml(plan.verification.prompt)}</code>${copyButton("verification-prompt", "verification request")}</div><p class="callout"><strong>Expected canonical tools:</strong> ${valueList(plan.verification.toolNames, "one policy-selected read-only tool")}. The request must stop before a write. A successful response verifies this activation path only; it grants no new authority.</p></div>
    </section>
    <section class="step" id="recover">
      <div class="step-head"><div><h2>6. Isolate activation failures</h2><p>Use the same structured process outside the host before changing policy or Discord permissions.</p></div><label class="done"><input type="checkbox" data-step autocomplete="off" aria-label="Review activation recovery">Checked</label></div>
      <div class="step-body"><p>If host startup fails, run this exact command-and-arguments pair from a safe process launcher. It replaces only the operational <code>serve</code> argument with <code>smoke</code>, negotiates stdio, and performs the documented read-only identity path.</p><details open><summary>Structured smoke launch</summary><div class="value-row"><pre id="smoke-descriptor" tabindex="0"><code>${escapeHtml(smokeDescriptor(plan))}</code></pre>${copyButton("smoke-descriptor", "structured smoke launch")}</div></details><p>If smoke passes, compare the host's command, ordered arguments, secret forwarding, stdio transport, required-server behavior, approval controls, elicitation support, and timeouts field by field. Use <code>full</code> tool surface when the host does not reliably refresh after <code>notifications/tools/list_changed</code>. Do not broaden Discord permissions or move a token into static configuration to make startup pass.</p></div>
    </section>
    <details class="panel"><summary>Inspect the complete credential-free activation plan</summary><pre tabindex="0"><code>${escapeHtml(exactPlan)}</code></pre></details>
    <details class="panel"><summary>Inspect the complete verified adapter catalog</summary><pre tabindex="0"><code>${escapeHtml(exactAdapterCatalog)}</code></pre></details>
    <p id="copy-status" class="status" role="status" aria-live="polite"></p>
  </main>
  <footer class="footer"><div class="shell"><p>Checklist state exists only in this open document and resets on reload. Generating this file projected deterministic host adapters but read no credential, contacted no network or Discord endpoint, started no process, discovered no host, changed no configuration, and opened no browser.</p><p class="digest">${escapeHtml(plan.activationDigest)}</p></div></footer>
  <script>${HOST_ACTIVATION_SCRIPT}</script>
</body>
</html>
`
}

export async function exportDiscordHostActivationHtml(
  file: string,
  plan: HostActivationPlan,
  options: DiscordHostActivationHtmlExportOptions = {},
): Promise<DiscordHostActivationHtmlExportReport> {
  if (!verifyHostActivationPlan(plan)) {
    throw new ConfigurationError("Host activation HTML requires an exact credential-free plan")
  }
  const adapterCatalog = createHostAdapterCatalog(plan)
  const target = resolveExclusivePrivateFile(
    file,
    HOST_ACTIVATION_HTML_FILE_MESSAGES,
  )
  const content = renderDiscordHostActivationHtml(plan)
  await writeExclusivePrivateFile(
    target,
    content,
    HOST_ACTIVATION_HTML_FILE_MESSAGES,
    options.fileSystem,
  )
  return {
    activationDigest: plan.activationDigest,
    adapterDigests: Object.freeze(adapterCatalog.adapters.map((adapter) => adapter.adapterDigest)),
    adapterIds: Object.freeze(adapterCatalog.adapters.map((adapter) => adapter.id)),
    automaticNetwork: "disabled",
    browserOpened: false,
    bytes: Buffer.byteLength(content),
    credentialValuesEmbedded: false,
    credentialValuesRead: false,
    discordContacted: false,
    externalNavigationOrigins: Object.freeze([]),
    file: target,
    format: HOST_ACTIVATION_HTML_FORMAT,
    hostConfigurationChanged: false,
    hostDiscovered: false,
    htmlDigest: `sha256:${digest(content)}`,
    identifiersEmbedded: true,
    localPathsEmbedded: plan.policy.source.kind === "config"
      || plan.launch.secrets.files.length > 0
      || isAbsolute(plan.launch.command)
      || plan.launch.args.some((argument) => isAbsolute(argument)),
    outputFileCreated: true,
    processStarted: false,
    runtimeCredentialsRequired: true,
    schemaVersion: HOST_ACTIVATION_HTML_SCHEMA_VERSION,
    statePersistence: "disabled",
    status: "ok",
  }
}
