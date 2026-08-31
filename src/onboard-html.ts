import { createHash } from "node:crypto"

import { CONNECTOR_VERSION } from "./constants.js"
import { ConfigurationError } from "./errors.js"
import {
  resolveExclusivePrivateFile,
  writeExclusivePrivateFile,
  type ExclusivePrivateFileSystem,
} from "./exclusive-private-file.js"
import {
  verifyOnboardReport,
  type OnboardReport,
} from "./onboard.js"

export const ONBOARD_HTML_FORMAT = "guildcontrol.onboard-html.v1"
export const ONBOARD_HTML_SCHEMA_VERSION = 1

export interface OnboardHtmlExportOptions {
  readonly fileSystem?: ExclusivePrivateFileSystem
}

export interface OnboardHtmlExportReport {
  readonly automaticNetwork: "disabled"
  readonly browserOpened: false
  readonly bytes: number
  readonly credentialsEmbedded: false
  readonly file: string
  readonly format: typeof ONBOARD_HTML_FORMAT
  readonly hostConfigurationChanged: false
  readonly htmlDigest: string
  readonly onboardDigest: string
  readonly schemaVersion: typeof ONBOARD_HTML_SCHEMA_VERSION
  readonly statePersistence: "disabled"
  readonly status: "ok"
}

const FILE_MESSAGES = Object.freeze({
  exists: "Onboarding guide already exists; choose a new --html path or move the existing file",
  failure: "Onboarding guide could not be written",
  invalidPath: "Onboarding guide requires a valid HTML file path",
})

const HOST_FILE_PLACEHOLDER = "HOST_JSON_FILE"
const PLAN_DIGEST_PLACEHOLDER = "PLAN_DIGEST"
const SAFE_SHELL_ARGUMENT_PATTERN = /^[A-Za-z0-9_@%+=:,./-]+$/

const GUIDE_SCRIPT = `(function () {
  'use strict';
  const checks = Array.from(document.querySelectorAll('[data-check]'));
  const progress = document.getElementById('progress');
  const status = document.getElementById('copy-status');
  const hostFile = document.getElementById('host-file');
  const planDigest = document.getElementById('host-plan-digest');
  const planDigestStatus = document.getElementById('host-plan-digest-status');
  const shell = document.getElementById('host-shell');
  const apostrophe = String.fromCharCode(39);
  const doubleQuote = String.fromCharCode(34);
  const posixApostrophe = apostrophe + doubleQuote + apostrophe + doubleQuote + apostrophe;
  const shellArgument = (value, kind) => {
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
    const escaped = kind === 'powershell'
      ? value.split(apostrophe).join(apostrophe + apostrophe)
      : value.split(apostrophe).join(posixApostrophe);
    return apostrophe + escaped + apostrophe;
  };
  const refreshCommands = () => {
    const hostFileValue = hostFile && hostFile.value.length > 0 ? hostFile.value : '${HOST_FILE_PLACEHOLDER}';
    const digestReady = planDigest && /^sha256:[a-f0-9]{64}$/.test(planDigest.value);
    const planDigestValue = digestReady ? planDigest.value : '${PLAN_DIGEST_PLACEHOLDER}';
    const shellValue = shell ? shell.value : 'posix';
    if (planDigestStatus) {
      planDigestStatus.textContent = !planDigest || planDigest.value.length === 0
        ? 'Paste the digest printed by the reviewed plan.'
        : digestReady
          ? 'Digest format is ready for the apply command.'
          : 'Use the complete sha256: digest printed by the reviewed plan.';
    }
    document.querySelectorAll('[data-command-args]').forEach((command) => {
      const encoded = command.getAttribute('data-command-args');
      if (!encoded) return;
      const args = JSON.parse(encoded).map((argument) => {
        if (argument === '${HOST_FILE_PLACEHOLDER}') return hostFileValue;
        if (argument === '${PLAN_DIGEST_PLACEHOLDER}') return planDigestValue;
        return argument;
      });
      command.textContent = args.map((argument) => shellArgument(argument, shellValue)).join(' ');
    });
  };
  const update = () => {
    const complete = checks.filter((check) => check.checked).length;
    progress.textContent = complete + ' of ' + checks.length + ' checkpoints reviewed';
  };
  checks.forEach((check) => check.addEventListener('change', update));
  [hostFile, planDigest, shell].filter(Boolean).forEach((control) => {
    control.addEventListener('input', refreshCommands);
    control.addEventListener('change', refreshCommands);
  });
  document.addEventListener('click', async (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const source = document.getElementById(button.dataset.copy || '');
    if (!source) return;
    const value = source.textContent || '';
    try {
      await navigator.clipboard.writeText(value);
      status.textContent = 'Copied ' + (button.dataset.label || 'value');
    } catch {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(source);
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = 'Select the highlighted value and copy it manually';
    }
  });
  update();
  refreshCommands();
})();`

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function sha256(value: string, encoding: "base64" | "hex" = "hex"): string {
  return createHash("sha256").update(value).digest(encoding)
}

function copyButton(id: string, label: string): string {
  const accessibleLabel = `Copy ${label}`
  return `<button type="button" data-copy="${escapeHtml(id)}" data-label="${escapeHtml(label)}" aria-label="${escapeHtml(accessibleLabel)}" title="${escapeHtml(accessibleLabel)}">Copy</button>`
}

function codeBlock(id: string, value: string, label: string): string {
  return `<div class="copy-row"><pre id="${escapeHtml(id)}" tabindex="0"><code>${escapeHtml(value)}</code></pre>${copyButton(id, label)}</div>`
}

function shellArgument(value: string): string {
  if (SAFE_SHELL_ARGUMENT_PATTERN.test(value)) return value
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

function shellCommand(args: readonly string[]): string {
  return args.map(shellArgument).join(" ")
}

function commandBlock(id: string, args: readonly string[], label: string): string {
  const encoded = escapeHtml(JSON.stringify(args))
  return `<div class="copy-row"><pre tabindex="0"><code id="${escapeHtml(id)}" data-command-args="${encoded}">${escapeHtml(shellCommand(args))}</code></pre>${copyButton(id, label)}</div>`
}

function list(values: readonly string[]): string {
  return `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`
}

function credentialHandoffMarkup(report: OnboardReport): string {
  const handoff = report.credentialHandoff
  const state = handoff.additionalTokenEntry === "required" ? "attention" : "good"
  return `<div class="callout ${state}"><strong>${escapeHtml(handoff.summary)}</strong>${list(handoff.details)}</div>`
}

function reviewedInstallerMarkup(report: OnboardReport): string {
  if (report.host.route.kind !== "adapter") return ""
  const adapter = report.host.route.adapter
  if (adapter.format !== "json") {
    return `<h3>Install this projection manually</h3><p class="callout attention"><strong>Review boundary:</strong> ${escapeHtml(adapter.title)} uses TOML. GuildControl deliberately does not parse or rewrite TOML, so merge the exact table above into a host-selected file and use the host's own configuration diagnostics.</p>`
  }
  const commonArgs = [
    "npx",
    "--yes",
    `guildctl@${CONNECTOR_VERSION}`,
    "host",
  ]
  const activationArgs = [
    "--npx",
    "--config",
    report.configFile,
    "--adapter",
    adapter.id,
  ]
  const planArgs = [
    ...commonArgs,
    "plan",
    ...activationArgs,
    "--host-file",
    HOST_FILE_PLACEHOLDER,
  ]
  const applyArgs = [
    ...commonArgs,
    "apply",
    ...activationArgs,
    "--host-file",
    HOST_FILE_PLACEHOLDER,
    "--plan-digest",
    PLAN_DIGEST_PLACEHOLDER,
    "--confirm",
    adapter.hostServerName,
  ]
  const inspectArgs = [
    ...commonArgs,
    ...activationArgs,
    "--inspect-host-file",
    HOST_FILE_PLACEHOLDER,
  ]
  return `
    <h3>Use the reviewed file installer</h3>
    <p>Choose the exact JSON destination yourself. The page turns that path and the reviewed plan digest into commands in memory only; it does not discover, read, or change the file.</p>
    <div class="command-controls">
      <label><span>Terminal</span><select id="host-shell"><option value="posix">Bash or zsh</option><option value="powershell">PowerShell</option></select></label>
      <label><span>Exact host JSON file</span><input id="host-file" type="text" autocomplete="off" spellcheck="false" placeholder="/absolute/path/to/mcp.json"></label>
      <div class="command-field"><label><span>Plan digest after review</span><input id="host-plan-digest" type="text" autocomplete="off" spellcheck="false" placeholder="sha256:..." pattern="sha256:[a-f0-9]{64}" aria-describedby="host-plan-digest-status"></label><small id="host-plan-digest-status" role="status">Paste the digest printed by the reviewed plan.</small></div>
    </div>
    <p class="meta">Nothing entered here is persisted or transmitted. Use one of the host's documented destinations shown above; GuildControl will not guess a path.</p>
    <h4>1. Plan without changing the file</h4>
    ${commandBlock("host-plan-command", planArgs, "host plan command")}
    <p>Review the operation, unrelated-state behavior, backup requirement, and confirmation value. Then paste its <code>sha256:...</code> plan digest above.</p>
    <h4>2. Apply that exact fresh plan</h4>
    ${commandBlock("host-apply-command", applyArgs, "host apply command")}
    <p>The apply command recomputes the plan, rejects stale state, requires the exact <code>${escapeHtml(adapter.hostServerName)}</code> confirmation, preserves a recoverable backup when replacing a file, and verifies the installed projection.</p>
    <h4>3. Reload the host and inspect if needed</h4>
    ${commandBlock("host-inspect-command", inspectArgs, "host inspection command")}
    <p class="callout"><strong>Proof boundary:</strong> an exact file inspection still does not prove that the host loaded this path, started GuildControl, or reached Discord. Reload the host and complete the first read below.</p>`
}

function hostMarkup(report: OnboardReport): string {
  if (report.host.route.kind === "mcpb") {
    const route = report.host.route
    return `
      ${credentialHandoffMarkup(report)}
      <p>Import the verified cross-platform bundle and select the exact policy file below. Enter the token only through Claude Desktop's protected sensitive-input prompt.</p>
      <div class="action-row"><a class="primary" href="${escapeHtml(route.downloadUrl)}" rel="noreferrer noopener">Download ${escapeHtml(route.archiveName)}</a></div>
      <h3>Import checklist</h3>
      ${list(route.instructions)}
      <h3>Host boundary</h3>
      ${list(route.limitations)}`
  }
  const adapter = report.host.route.adapter
  return `
    ${credentialHandoffMarkup(report)}
    <p>Merge only the generated <code>${escapeHtml(adapter.hostServerName)}</code> server projection into one destination below. Preserve unrelated host configuration.</p>
    <p class="meta"><strong>Suggested destinations:</strong> ${escapeHtml(adapter.destinations.join("; "))}</p>
    ${codeBlock("host-config", adapter.content, `${adapter.title} configuration`)}
    <h3>Activation checklist</h3>
    ${list(adapter.instructions)}
    ${reviewedInstallerMarkup(report)}
    <h3>Host boundary</h3>
    ${list(adapter.limitations)}`
}

function warningMarkup(report: OnboardReport): string {
  if (report.setup.warnings.length === 0) {
    return `<p class="callout good"><strong>No setup warnings.</strong> The exact read-only policy and Discord installation verified cleanly.</p>`
  }
  return `<div class="callout attention"><strong>Setup warnings to review</strong>${list(report.setup.warnings)}</div>`
}

export function renderOnboardHtml(value: OnboardReport): string {
  if (!verifyOnboardReport(value)) {
    throw new ConfigurationError("Onboarding guide requires exact digest-bound onboarding evidence")
  }
  const report = value
  const scriptHash = sha256(GUIDE_SCRIPT, "base64")
  const evidence = JSON.stringify(report, null, 2)
  const credentialReference = report.setup.credential.provider === "environment"
    ? `Environment variable ${report.setup.credential.variable}`
    : `Protected file ${report.setup.credential.path}`
  const recoveryCommands = [
    shellCommand(["npx", "--yes", `guildctl@${CONNECTOR_VERSION}`, "doctor", "--config", report.configFile, "--online"]),
    shellCommand(["npx", "--yes", `guildctl@${CONNECTOR_VERSION}`, "smoke", "--config", report.configFile]),
    ...(report.host.route.kind === "adapter"
      ? [shellCommand(["npx", "--yes", `guildctl@${CONNECTOR_VERSION}`, "host", "--npx", "--config", report.configFile, "--adapter", report.host.route.adapter.id])]
      : []),
  ].join("\n")
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; img-src 'none'; manifest-src 'none'; media-src 'none'; object-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; worker-src 'none'">
  <meta name="description" content="Private credential-free GuildControl onboarding evidence and host activation guide">
  <title>GuildControl is ready for ${escapeHtml(report.host.title)}</title>
  <style>
    :root{--bg:#f4f5fa;--panel:#fff;--panel2:#f8f9fc;--ink:#171b2d;--muted:#596078;--line:#d9ddea;--brand:#4652d9;--brand2:#26329e;--good:#08765f;--attention:#9b5700;--focus:#c44e00;--shadow:0 18px 50px rgba(30,38,78,.09)}
    @media(prefers-color-scheme:dark){:root{--bg:#0d111b;--panel:#171d2a;--panel2:#111723;--ink:#eef1ff;--muted:#abb3c8;--line:#343c50;--brand:#8e97ff;--brand2:#b5bbff;--good:#63d5b5;--attention:#ffc16e;--focus:#ffd166;--shadow:0 18px 50px rgba(0,0,0,.28)}}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55}.shell{width:min(1120px,calc(100% - 2rem));margin:auto}.skip{position:fixed;top:-5rem;left:1rem;z-index:20;padding:.7rem 1rem;border:2px solid var(--focus);border-radius:.7rem;background:var(--panel);color:var(--ink)}.skip:focus{top:1rem}.hero{padding:4rem 0 2rem}.eyebrow{margin:0 0 .7rem;color:var(--brand2);font-size:.76rem;font-weight:850;letter-spacing:.14em;text-transform:uppercase}.hero h1{max-width:900px;margin:0;font-size:clamp(2.6rem,7vw,5.8rem);line-height:.95;letter-spacing:-.058em}.lede{max-width:780px;margin:1.3rem 0;color:var(--muted);font-size:clamp(1rem,2vw,1.2rem)}.proofs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.7rem;margin:2rem 0}.proof{min-width:0;padding:1rem;border:1px solid var(--line);border-radius:1rem;background:var(--panel);box-shadow:var(--shadow)}.proof strong{display:block;overflow-wrap:anywhere}.proof span,.meta{color:var(--muted);font-size:.82rem}.rail-wrap{position:sticky;top:0;z-index:10;border-block:1px solid var(--line);background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(14px)}.rail{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:1rem;padding:.8rem 0}.rail ol{display:grid;grid-template-columns:repeat(5,minmax(8rem,1fr));gap:.45rem;margin:0;padding:0;list-style:none}.rail a{display:block;padding:.55rem .65rem;border-radius:.65rem;color:var(--muted);font-size:.78rem;font-weight:750;text-align:center;text-decoration:none}.rail a:hover{background:var(--panel);color:var(--ink)}#progress{font-size:.78rem;color:var(--muted);white-space:nowrap}main{padding:2rem 0 4rem}.step{scroll-margin-top:7rem;margin:1rem 0;padding:1.35rem;border:1px solid var(--line);border-radius:1rem;background:var(--panel);box-shadow:var(--shadow)}.step-head{display:flex;align-items:start;justify-content:space-between;gap:1rem}.title{display:flex;gap:.9rem}.number{display:grid;flex:0 0 auto;width:2.3rem;height:2.3rem;place-items:center;border-radius:.75rem;background:#26329e;color:#fff;font-weight:900}.step h2{margin:0;font-size:clamp(1.35rem,3vw,2rem);letter-spacing:-.025em}.step h3{margin:1.4rem 0 .5rem}.step h4{margin:1.1rem 0 .4rem}.step p{overflow-wrap:anywhere}.done{display:flex;align-items:center;gap:.45rem;padding:.45rem .65rem;border:1px solid var(--line);border-radius:.65rem;color:var(--muted);font-size:.78rem;font-weight:800;white-space:nowrap}.done input{width:1.05rem;height:1.05rem;margin:0;accent-color:var(--brand)}.body{margin-top:1.1rem;padding-top:1.1rem;border-top:1px solid var(--line)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.field{min-width:0;padding:.9rem;border:1px solid var(--line);border-radius:.75rem;background:var(--panel2)}.field span,.command-controls label>span{display:block;margin-bottom:.25rem;color:var(--muted);font-size:.69rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.field code{overflow-wrap:anywhere}.command-controls{display:grid;grid-template-columns:minmax(9rem,.65fr) repeat(2,minmax(0,1fr));gap:.75rem;margin:.85rem 0}.command-controls label{min-width:0}.command-field{min-width:0}.command-field small{display:block;margin-top:.3rem;color:var(--muted);font-size:.72rem}.command-controls input,.command-controls select{width:100%;min-height:2.65rem;padding:.55rem .7rem;border:1px solid var(--line);border-radius:.65rem;background:var(--panel2);color:var(--ink);font:inherit;font-size:.84rem}.copy-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:.65rem;margin:.7rem 0}.copy-row pre{max-height:28rem;overflow:auto;margin:0;padding:1rem;border:1px solid var(--line);border-radius:.75rem;background:var(--panel2);white-space:pre-wrap;overflow-wrap:anywhere;font-size:.76rem}.copy-row button,.primary{min-height:2.5rem;padding:.52rem .8rem;border:1px solid var(--line);border-radius:.65rem;background:var(--panel);color:var(--ink);font:inherit;font-size:.8rem;font-weight:800;cursor:pointer;text-decoration:none}.copy-row button:hover{border-color:var(--brand);color:var(--brand2)}.primary{display:inline-flex;align-items:center;justify-content:center;background:var(--brand2);border-color:var(--brand2);color:#fff}.primary:hover{filter:brightness(1.13)}.action-row{display:flex;flex-wrap:wrap;gap:.75rem}.callout{padding:.85rem 1rem;border-left:4px solid var(--line);border-radius:.35rem .7rem .7rem .35rem;background:var(--panel2)}.callout.good{border-color:var(--good)}.callout.attention{border-color:var(--attention)}ul{padding-left:1.25rem}li+li{margin-top:.32rem}.evidence{margin:1rem 0;border:1px solid var(--line);border-radius:1rem;background:var(--panel)}.evidence summary{padding:1rem;cursor:pointer;font-weight:850}.evidence pre{max-height:34rem;overflow:auto;margin:0 1rem 1rem;padding:1rem;border-radius:.75rem;background:var(--panel2);font-size:.72rem}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,pre:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:2px}#copy-status{min-height:1.4rem;color:var(--good);font-size:.82rem}footer{padding:2rem 0 4rem;border-top:1px solid var(--line);color:var(--muted);font-size:.82rem}
    @media(max-width:850px){.proofs,.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.command-controls{grid-template-columns:minmax(0,1fr)}.rail{grid-template-columns:1fr;overflow:auto}.rail ol{width:max-content}.step-head{flex-direction:column}.done{align-self:flex-start}}
    @media(max-width:560px){.shell{width:min(100% - 1rem,1120px)}.hero{padding-top:2.7rem}.proofs,.grid{grid-template-columns:minmax(0,1fr)}.rail-wrap{position:static}.step{scroll-margin-top:1rem;padding:1rem}.copy-row{grid-template-columns:1fr}.copy-row button{justify-self:start}}
    @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
  </style>
</head>
<body>
  <a class="skip" href="#main">Skip to activation</a>
  <header class="shell hero">
    <p class="eyebrow">Verified local Discord control</p>
    <h1>GuildControl is ready for ${escapeHtml(report.host.title)}.</h1>
    <p class="lede">The owner-managed bot, exact guild scope, read-only policy, and real stdio MCP path have all been verified. Finish the host handoff below, then make one useful read-only request.</p>
    <div class="proofs" role="list" aria-label="Verified onboarding evidence">
      <div class="proof" role="listitem"><strong>${escapeHtml(report.install.guildId)}</strong><span>Exact Discord guild</span></div>
      <div class="proof" role="listitem"><strong>${escapeHtml(report.setup.botId)}</strong><span>Verified bot identity</span></div>
      <div class="proof" role="listitem"><strong>stdio passed</strong><span>${report.smoke.toolCount} tools negotiated</span></div>
      <div class="proof" role="listitem"><strong>Read only</strong><span>Server observer preset</span></div>
    </div>
    <p class="meta"><strong>Evidence digest:</strong> <code>${escapeHtml(report.onboardDigest)}</code></p>
  </header>
  <div class="rail-wrap">
    <nav class="shell rail" aria-label="Onboarding checkpoints">
      <span id="progress"></span>
      <ol><li><a href="#install">1. Install</a></li><li><a href="#policy">2. Policy</a></li><li><a href="#smoke">3. Smoke</a></li><li><a href="#host">4. Host</a></li><li><a href="#first-read">5. First read</a></li></ol>
    </nav>
  </div>
  <main class="shell" id="main">
    <section class="step" id="install">
      <div class="step-head"><div class="title"><span class="number">1</span><div><h2>Discord installation verified</h2><p class="meta">The callback-free grant was locked to one guild and requested no Administrator permission.</p></div></div><label class="done"><input type="checkbox" data-check> Reviewed</label></div>
      <div class="body grid"><div class="field"><span>Application ID</span><code>${escapeHtml(report.install.applicationId)}</code></div><div class="field"><span>Guild ID</span><code>${escapeHtml(report.install.guildId)}</code></div><div class="field"><span>Permission bitfield</span><code>${escapeHtml(report.install.permissions.bitfield)}</code></div><div class="field"><span>Permissions</span><code>${escapeHtml(report.install.permissions.names.join(", "))}</code></div></div>
    </section>
    <section class="step" id="policy">
      <div class="step-head"><div class="title"><span class="number">2</span><div><h2>Private policy pinned</h2><p class="meta">The policy stores a credential reference, never the credential value.</p></div></div><label class="done"><input type="checkbox" data-check> Reviewed</label></div>
      <div class="body"><div class="grid"><div class="field"><span>Policy file</span><code>${escapeHtml(report.configFile)}</code></div><div class="field"><span>Credential custody</span><code>${escapeHtml(credentialReference)}</code></div><div class="field"><span>Setup access</span><code>${escapeHtml(report.credentialHandoff.setupAccess)}</code></div><div class="field"><span>Host action</span><code>${escapeHtml(report.credentialHandoff.hostAction)}</code></div><div class="field"><span>Preset</span><code>${escapeHtml(report.setup.preset?.name || "")}</code></div><div class="field"><span>Tool surface</span><code>${escapeHtml(report.setup.toolSurface)}</code></div></div>${warningMarkup(report)}</div>
    </section>
    <section class="step" id="smoke">
      <div class="step-head"><div class="title"><span class="number">3</span><div><h2>The real MCP path passed</h2><p class="meta">A child process started, negotiated MCP, checked catalogs, and called only discovery plus connector status.</p></div></div><label class="done"><input type="checkbox" data-check> Reviewed</label></div>
      <div class="body grid"><div class="field"><span>Transport</span><code>${escapeHtml(report.smoke.transport)}</code></div><div class="field"><span>Protocol</span><code>${escapeHtml(report.smoke.protocolVersion)}</code></div><div class="field"><span>Server</span><code>${escapeHtml(`${report.smoke.serverName}@${report.smoke.serverVersion}`)}</code></div><div class="field"><span>Guilds in scope</span><code>${report.smoke.installedInScopeGuildCount}</code></div></div>
    </section>
    <section class="step" id="host">
      <div class="step-head"><div class="title"><span class="number">4</span><div><h2>Activate ${escapeHtml(report.host.title)}</h2><p class="meta">This guide does not edit, discover, or claim to verify the host's configuration.</p></div></div><label class="done"><input type="checkbox" data-check> Activated</label></div>
      <div class="body">${hostMarkup(report)}</div>
    </section>
    <section class="step" id="first-read">
      <div class="step-head"><div class="title"><span class="number">5</span><div><h2>First read-only request</h2><p class="meta">Reload the host, confirm GuildControl connected, then send this exact write-disabled request.</p></div></div><label class="done"><input type="checkbox" data-check> Complete</label></div>
      <div class="body">${codeBlock("first-read-prompt", report.firstRead.prompt, "first read request")}<p class="callout good"><strong>Expected boundary:</strong> the host may use <code>${escapeHtml(report.firstRead.toolNames.join(", "))}</code>; no Discord write is authorized.</p><h3>Recovery commands</h3>${codeBlock("recovery", recoveryCommands, "recovery commands")}<p id="copy-status" role="status" aria-live="polite"></p></div>
    </section>
    <details class="evidence"><summary>Inspect complete credential-free evidence</summary><pre tabindex="0"><code>${escapeHtml(evidence)}</code></pre></details>
  </main>
  <footer><div class="shell">Generated locally by GuildControl ${escapeHtml(CONNECTOR_VERSION)}. No credential value, message content, external asset, telemetry, or persistent browser state is present.</div></footer>
  <script>${GUIDE_SCRIPT}</script>
</body>
</html>`
}

export async function exportOnboardHtml(
  file: string,
  report: OnboardReport,
  options: OnboardHtmlExportOptions = {},
): Promise<OnboardHtmlExportReport> {
  const target = resolveExclusivePrivateFile(file, FILE_MESSAGES)
  const html = renderOnboardHtml(report)
  await writeExclusivePrivateFile(
    target,
    html,
    FILE_MESSAGES,
    options.fileSystem,
  )
  return Object.freeze({
    automaticNetwork: "disabled" as const,
    browserOpened: false as const,
    bytes: Buffer.byteLength(html),
    credentialsEmbedded: false as const,
    file: target,
    format: ONBOARD_HTML_FORMAT,
    hostConfigurationChanged: false as const,
    htmlDigest: `sha256:${sha256(html)}`,
    onboardDigest: report.onboardDigest,
    schemaVersion: ONBOARD_HTML_SCHEMA_VERSION,
    statePersistence: "disabled" as const,
    status: "ok" as const,
  })
}
