import { createHash } from "node:crypto"

import {
  createBotInstallPlan,
  type BotInstallPlan,
} from "./bot-install.js"
import { CONNECTOR_VERSION } from "./constants.js"
import { ConfigurationError } from "./errors.js"
import {
  resolveExclusivePrivateFile,
  writeExclusivePrivateFile,
  type ExclusivePrivateFileSystem,
} from "./exclusive-private-file.js"

export const ONBOARDING_HTML_FORMAT = "discord-mcp.onboarding-html.v1"
export const ONBOARDING_HTML_SCHEMA_VERSION = 1

export interface DiscordOnboardingHtmlExportOptions {
  fileSystem?: ExclusivePrivateFileSystem
}

export interface DiscordOnboardingHtmlExportReport {
  activityRecordsCreated: false
  automaticNetwork: "disabled"
  browserOpened: false
  bytes: number
  clientSpecificConfiguration: false
  credentialsEmbedded: false
  credentialsRequired: false
  discordContacted: false
  externalNavigationOrigins: readonly ["https://discord.com"]
  file: string
  format: typeof ONBOARDING_HTML_FORMAT
  htmlDigest: string
  planDigest: string
  schemaVersion: typeof ONBOARDING_HTML_SCHEMA_VERSION
  statePersistence: "disabled"
  status: "ok"
}

const ONBOARDING_HTML_FILE_MESSAGES = Object.freeze({
  exists: "Onboarding HTML target already exists; choose a new path or move the existing file",
  failure: "Onboarding HTML export could not be written",
  invalidPath: "Onboarding HTML export requires a valid file path",
})

const ONBOARDING_SCRIPT = `(function () {
  'use strict';
  const stepInputs = Array.from(document.querySelectorAll('[data-step]'));
  const progress = document.getElementById('setup-progress');
  const progressText = document.getElementById('progress-text');
  const copyStatus = document.getElementById('copy-status');
  const updateProgress = () => {
    const complete = stepInputs.filter((input) => input.checked).length;
    progress.value = complete;
    progressText.textContent = complete + ' of ' + stepInputs.length + ' steps checked';
  };
  stepInputs.forEach((input) => input.addEventListener('change', updateProgress));
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
  updateProgress();
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

function planDigest(plan: BotInstallPlan): string {
  return `sha256:${digest(JSON.stringify(plan))}`
}

function copyButton(target: string, label: string): string {
  return `<button type="button" class="copy" data-copy-target="${escapeHtml(target)}" data-copy-label="${escapeHtml(label)}">Copy</button>`
}

function commandBlock(command: string, index: number): string {
  const id = `command-${index + 1}`
  return `<div class="command"><code id="${id}">${escapeHtml(command)}</code>${copyButton(id, `command ${index + 1}`)}</div>`
}

function intentMarkup(plan: BotInstallPlan): string {
  if (plan.privilegedIntents.length === 0) {
    return `<p class="callout good"><strong>No privileged intent is required.</strong> Leave privileged intent toggles off for this preset.</p>`
  }
  return `<p class="callout attention"><strong>Enable Message Content on the Bot page.</strong> This preset recommends <code>${escapeHtml(plan.privilegedIntents[0]?.name || "")}</code> so Discord can return message bodies through its APIs. Verified apps also need Discord approval.</p>`
}

function permissionMarkup(plan: BotInstallPlan): string {
  return plan.permissions.names.map((permission) => (
    `<li><code>${escapeHtml(permission)}</code></li>`
  )).join("")
}

function exactPlan(plan: BotInstallPlan): BotInstallPlan {
  const canonical = createBotInstallPlan({
    applicationId: plan.applicationId,
    guildId: plan.guildId,
    preset: plan.preset.name,
  })
  if (JSON.stringify(canonical) !== JSON.stringify(plan)) {
    throw new ConfigurationError(
      "Onboarding HTML export requires an exact bot installation plan",
    )
  }
  return canonical
}

export function renderDiscordOnboardingHtml(plan: BotInstallPlan): string {
  const planHash = planDigest(plan)
  const scriptHash = digest(ONBOARDING_SCRIPT, "base64")
  const portalUrl = `https://discord.com/developers/applications/${plan.applicationId}`
  const permissions = plan.permissions.names.join(", ")
  const [setup, validate, doctor, smoke] = plan.postInstall.commands
  const commandMarkup = plan.postInstall.commands.slice(1).map(commandBlock).join("")
  const evidence = escapeHtml(JSON.stringify(plan, null, 2))
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; img-src 'none'; manifest-src 'none'; media-src 'none'; object-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; worker-src 'none'; require-trusted-types-for 'script'">
  <meta name="description" content="Credential-free Discord MCP onboarding guide">
  <title>Discord MCP onboarding: ${escapeHtml(plan.preset.name)}</title>
  <style>
    :root{--bg:#f4f6fb;--panel:#fff;--panel-2:#f8f9fd;--ink:#172036;--muted:#56617a;--line:#d8deec;--brand:#5865f2;--brand-2:#3944bd;--action:#3b46bf;--action-hover:#2d379f;--good:#087c62;--attention:#a15b00;--focus:#bc4d00;--shadow:0 18px 55px rgba(32,43,76,.1)}
    @media(prefers-color-scheme:dark){:root{--bg:#0c111c;--panel:#151c2a;--panel-2:#101725;--ink:#edf1ff;--muted:#aab4ca;--line:#30394d;--brand:#8993ff;--brand-2:#b2b8ff;--action:#3b46bf;--action-hover:#2d379f;--good:#67d5b6;--attention:#ffc06d;--focus:#ffd166;--shadow:0 18px 55px rgba(0,0,0,.3)}}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55}.shell{width:min(1120px,calc(100% - 2rem));margin:0 auto}.skip-link{position:fixed;left:1rem;top:-5rem;z-index:30;padding:.7rem 1rem;border:2px solid var(--focus);border-radius:.7rem;background:var(--panel);color:var(--ink)}.skip-link:focus{top:1rem}.hero{padding:4.5rem 0 2rem}.eyebrow{margin:0 0 .6rem;color:var(--brand-2);font-size:.77rem;font-weight:850;letter-spacing:.14em;text-transform:uppercase}.hero h1{max-width:880px;margin:0;font-size:clamp(2.45rem,7vw,5.7rem);line-height:.94;letter-spacing:-.058em}.lede{max-width:780px;margin:1.4rem 0 0;color:var(--muted);font-size:clamp(1rem,2vw,1.22rem)}.proofs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin:2rem 0}.proof{min-width:0;padding:1rem;border:1px solid var(--line);border-radius:1rem;background:var(--panel);box-shadow:var(--shadow)}.proof strong{display:block;overflow-wrap:anywhere;font-size:1rem}.proof span{color:var(--muted);font-size:.78rem}.safety-banner{display:grid;grid-template-columns:1.2fr .8fr;gap:1rem;margin:1rem 0 2rem}.panel{min-width:0;padding:1.25rem;border:1px solid var(--line);border-radius:1rem;background:var(--panel);box-shadow:var(--shadow)}.panel h2,.panel h3{margin-top:0}.checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem;margin:0;padding:0;list-style:none}.checks li{padding:.72rem;border-radius:.7rem;background:var(--panel-2)}.checks li::before{content:"OK";display:inline-block;margin-right:.5rem;color:var(--good);font-size:.68rem;font-weight:900}.digest{overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.75rem;color:var(--muted)}.sticky{position:sticky;top:0;z-index:10;border-block:1px solid var(--line);background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(14px)}.progress-row{display:grid;grid-template-columns:auto minmax(10rem,1fr) auto;align-items:center;gap:1rem;padding:.7rem 0}.progress-row strong{white-space:nowrap}.progress-row span{color:var(--muted);font-size:.85rem}progress{width:100%;height:.65rem;border:0;border-radius:999px;overflow:hidden;background:var(--line)}progress::-webkit-progress-bar{background:var(--line)}progress::-webkit-progress-value{background:linear-gradient(90deg,var(--brand),var(--brand-2))}progress::-moz-progress-bar{background:linear-gradient(90deg,var(--brand),var(--brand-2))}.rail{overflow:auto;border-top:1px solid var(--line)}.rail ol{display:grid;grid-template-columns:repeat(6,minmax(8.5rem,1fr));gap:.5rem;margin:0;padding:.6rem 0;list-style:none}.rail a{display:flex;align-items:center;gap:.5rem;padding:.55rem .65rem;border-radius:.65rem;color:var(--muted);font-size:.78rem;font-weight:750;text-decoration:none;white-space:nowrap}.rail a:hover{background:var(--panel);color:var(--ink)}.rail b{display:grid;width:1.55rem;height:1.55rem;place-items:center;border-radius:999px;background:var(--panel);color:var(--brand-2)}main{padding:2rem 0 4rem;scroll-margin-top:8.5rem}.step{scroll-margin-top:8.5rem;margin:1rem 0;padding:1.35rem;border:1px solid var(--line);border-radius:1rem;background:var(--panel);box-shadow:var(--shadow)}.step-head{display:flex;align-items:start;justify-content:space-between;gap:1rem}.step-title{display:flex;align-items:start;gap:.9rem}.number{display:grid;flex:0 0 auto;width:2.3rem;height:2.3rem;place-items:center;border-radius:.75rem;background:var(--action);color:#fff;font-weight:900}.step h2{margin:0;font-size:clamp(1.35rem,3vw,2rem);letter-spacing:-.025em}.step-head p{margin:.35rem 0 0;color:var(--muted)}.done{display:flex;align-items:center;gap:.45rem;padding:.45rem .65rem;border:1px solid var(--line);border-radius:.65rem;color:var(--muted);font-size:.78rem;font-weight:800;white-space:nowrap}.done input{width:1.05rem;height:1.05rem;margin:0;accent-color:var(--brand)}.step-body{margin:1.15rem 0 0;padding-top:1.15rem;border-top:1px solid var(--line)}.split{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.85rem}.field{min-width:0;padding:1rem;border:1px solid var(--line);border-radius:.8rem;background:var(--panel-2)}.field-label{display:block;margin-bottom:.35rem;color:var(--muted);font-size:.7rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.value-row,.command{display:flex;align-items:center;justify-content:space-between;gap:.7rem}.value-row code,.command code{min-width:0;overflow-wrap:anywhere}.copy,.primary{min-height:2.5rem;padding:.48rem .75rem;border:1px solid var(--line);border-radius:.65rem;background:var(--panel);color:var(--ink);font:inherit;font-size:.8rem;font-weight:800;cursor:pointer;text-decoration:none}.copy:hover{border-color:var(--brand);color:var(--brand-2)}.primary{display:inline-flex;align-items:center;justify-content:center;background:var(--action);color:#fff;border-color:var(--action)}.primary:hover{color:#fff;background:var(--action-hover);border-color:var(--action-hover)}button:focus-visible,a:focus-visible,input:focus-visible,summary:focus-visible,pre:focus-visible{outline:3px solid var(--focus);outline-offset:2px}.callout{padding:.85rem 1rem;border-left:4px solid var(--line);border-radius:.35rem .7rem .7rem .35rem;background:var(--panel-2)}.callout.good{border-color:var(--good)}.callout.attention{border-color:var(--attention)}.permissions{display:flex;flex-wrap:wrap;gap:.5rem;margin:.8rem 0;padding:0;list-style:none}.permissions li{padding:.35rem .55rem;border:1px solid var(--line);border-radius:999px;background:var(--panel-2);font-size:.77rem}.command-list{display:grid;gap:.6rem}.command{padding:.8rem;border:1px solid var(--line);border-radius:.75rem;background:var(--panel-2)}.command code{white-space:pre-wrap}.action-row{display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;margin-top:1rem}.note{color:var(--muted);font-size:.84rem}.evidence{margin:1rem 0;border:1px solid var(--line);border-radius:1rem;background:var(--panel)}.evidence summary{padding:1rem;cursor:pointer;font-weight:850}.evidence-body{padding:0 1rem 1rem}.evidence pre{max-height:32rem;overflow:auto;margin:0;padding:1rem;border-radius:.75rem;background:var(--panel-2);font-size:.75rem;line-height:1.45}.status{min-height:1.5rem;color:var(--good);font-size:.84rem}footer{padding:2rem 0 4rem;border-top:1px solid var(--line);color:var(--muted);font-size:.82rem}
    @media(max-width:820px){.proofs{grid-template-columns:repeat(2,minmax(0,1fr))}.safety-banner,.split{grid-template-columns:minmax(0,1fr)}.step-head{align-items:stretch;flex-direction:column}.done{align-self:flex-start}.progress-row{grid-template-columns:1fr auto}.progress-row strong{grid-column:1/-1}.rail ol{width:max-content}}
    @media(max-width:520px){.shell{width:min(100% - 1rem,1120px)}.hero{padding-top:2.7rem}.proofs,.checks{grid-template-columns:minmax(0,1fr)}.step{padding:1rem}.step-title{gap:.65rem}.value-row,.command{align-items:stretch;flex-direction:column}.copy{align-self:flex-start}.progress-row{gap:.55rem}.rail a{font-size:.73rem}}
    @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
  </style>
</head>
<body>
  <a class="skip-link" href="#main">Skip to setup</a>
  <header class="shell hero">
    <p class="eyebrow">Owner-managed bot setup</p>
    <h1>Connect Discord without sharing custody.</h1>
    <p class="lede">This exact, credential-free guide installs your own Discord bot with the <strong>${escapeHtml(plan.preset.name)}</strong> read-only preset, creates one strict policy file, and verifies the real MCP path before a host connects.</p>
    <div class="proofs" role="list" aria-label="Installation boundaries">
      <div class="proof" role="listitem"><strong>${escapeHtml(plan.preset.name)}</strong><span>Exact read-only preset</span></div>
      <div class="proof" role="listitem"><strong>${escapeHtml(plan.permissions.bitfield)}</strong><span>Discord permission bitfield</span></div>
      <div class="proof" role="listitem"><strong>Guild locked</strong><span>No user install or callback</span></div>
      <div class="proof" role="listitem"><strong>No token</strong><span>Credential never enters this page</span></div>
    </div>
    <div class="safety-banner">
      <section class="panel" aria-labelledby="boundary-title">
        <h2 id="boundary-title">What this artifact cannot do</h2>
        <ul class="checks">
          <li>Cannot call Discord in the background</li>
          <li>Cannot read or store a bot token</li>
          <li>Cannot configure an MCP host</li>
          <li>Cannot write to a Discord guild</li>
          <li>Cannot persist checklist state</li>
          <li>Cannot load external assets or telemetry</li>
        </ul>
      </section>
      <section class="panel" aria-labelledby="evidence-title">
        <h2 id="evidence-title">Exact plan evidence</h2>
        <p><strong>Connector version</strong><br><code>${escapeHtml(CONNECTOR_VERSION)}</code></p>
        <p><strong>Artifact format</strong><br><code>${ONBOARDING_HTML_FORMAT}</code></p>
        <p class="digest"><strong>Plan digest</strong><br>${planHash}</p>
      </section>
    </div>
  </header>
  <div class="sticky">
    <section class="shell progress-row" aria-label="Checklist progress">
      <strong>Your local checklist</strong>
      <progress id="setup-progress" max="6" value="0" aria-label="Onboarding progress"></progress>
      <span id="progress-text" aria-live="polite">0 of 6 steps checked</span>
    </section>
    <nav class="shell rail" aria-label="Onboarding steps">
      <ol>
        <li><a href="#step-1"><b>1</b>Own the app</a></li>
        <li><a href="#step-2"><b>2</b>Set intents</a></li>
        <li><a href="#step-3"><b>3</b>Install bot</a></li>
        <li><a href="#step-4"><b>4</b>Mount secret</a></li>
        <li><a href="#step-5"><b>5</b>Create policy</a></li>
        <li><a href="#step-6"><b>6</b>Verify and connect</a></li>
      </ol>
    </nav>
  </div>
  <main id="main" class="shell" tabindex="-1">
    <section class="step" id="step-1">
      <div class="step-head"><div class="step-title"><span class="number">1</span><div><h2>Own the Discord application</h2><p>Create the application and bot in Discord's Developer Portal, then keep ownership and credential custody.</p></div></div><label class="done"><input type="checkbox" data-step autocomplete="off" aria-label="Mark step 1 complete">Checked</label></div>
      <div class="step-body">
        <div class="split">
          <div class="field"><span class="field-label">Application ID</span><div class="value-row"><code id="application-id">${escapeHtml(plan.applicationId)}</code>${copyButton("application-id", "Application ID")}</div></div>
          <div class="field"><span class="field-label">Target guild ID</span><div class="value-row"><code id="guild-id">${escapeHtml(plan.guildId)}</code>${copyButton("guild-id", "Guild ID")}</div></div>
        </div>
        <p class="callout">Enable Guild Install on the Installation page and keep Public Bot disabled unless other people should install this application. Use the Bot page to create or reset the token. Discord shows it only at creation or reset, so place it directly into a secret-capable launcher or password manager. Do not paste it into this page, a policy file, source control, or an issue.</p>
        <div class="action-row"><a class="primary" href="${escapeHtml(portalUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open this application in Discord</a><span class="note">Explicit navigation to discord.com</span></div>
      </div>
    </section>
    <section class="step" id="step-2">
      <div class="step-head"><div class="step-title"><span class="number">2</span><div><h2>Enable only the required intents</h2><p>Privileged intents change what Discord may disclose. Keep every unnecessary toggle off.</p></div></div><label class="done"><input type="checkbox" data-step autocomplete="off" aria-label="Mark step 2 complete">Checked</label></div>
      <div class="step-body">${intentMarkup(plan)}<p class="note">The connector uses REST for this preset and keeps the Gateway disabled. Discord's privileged-intent setting still controls protected fields returned through HTTP.</p></div>
    </section>
    <section class="step" id="step-3">
      <div class="step-head"><div class="step-title"><span class="number">3</span><div><h2>Install the bot into the exact guild</h2><p>Review the fixed-origin authorization request, then deliberately open it.</p></div></div><label class="done"><input type="checkbox" data-step autocomplete="off" aria-label="Mark step 3 complete">Checked</label></div>
      <div class="step-body">
        <p><strong>Requested bot permissions</strong></p><ul class="permissions">${permissionMarkup(plan)}</ul>
        <div class="split">
          <div class="field"><span class="field-label">Permission summary</span><strong>${escapeHtml(permissions)}</strong><p class="note">Bitfield <code>${escapeHtml(plan.permissions.bitfield)}</code></p></div>
          <div class="field"><span class="field-label">Authorization boundary</span><strong>Bot scope, guild locked</strong><p class="note">No Administrator, callback, user token, or user-install context</p></div>
        </div>
        <p class="callout attention"><strong>Review Discord's confirmation screen.</strong> The guild must be <code>${escapeHtml(plan.guildId)}</code> and the requested permissions must match this page. Cancel if they do not.</p>
        <div class="action-row"><a class="primary" href="${escapeHtml(plan.installUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Review and install in Discord</a>${copyButton("install-url", "install URL")}<span class="note">Explicit navigation to discord.com</span></div>
        <p id="install-url" class="digest">${escapeHtml(plan.installUrl)}</p>
      </div>
    </section>
    <section class="step" id="step-4">
      <div class="step-head"><div class="step-title"><span class="number">4</span><div><h2>Mount the token as a secret</h2><p>Expose the bot token only to the local connector process through a host secret setting or protected file.</p></div></div><label class="done"><input type="checkbox" data-step autocomplete="off" aria-label="Mark step 4 complete">Checked</label></div>
      <div class="step-body">
        <div class="field"><span class="field-label">Default secret reference</span><div class="value-row"><code id="credential-variable">${escapeHtml(plan.postInstall.credentialVariable)}</code>${copyButton("credential-variable", "credential reference")}</div></div>
        <p class="callout good"><strong>The JSON policy stores only this reference.</strong> It rejects an inline token. A protected absolute token file is also supported during setup when the launcher mounts secrets as files.</p>
        <p class="note">This guide intentionally provides no token field and no token-bearing command. Secret storage differs by operating system and MCP host.</p>
      </div>
    </section>
    <section class="step" id="step-5">
      <div class="step-head"><div class="step-title"><span class="number">5</span><div><h2>Create the strict non-secret policy</h2><p>Run verified setup after the bot token is available to the connector process.</p></div></div><label class="done"><input type="checkbox" data-step autocomplete="off" aria-label="Mark step 5 complete">Checked</label></div>
      <div class="step-body">
        <div class="command"> <code id="setup-command">${escapeHtml(setup || "")}</code>${copyButton("setup-command", "setup command")}</div>
        ${plan.preset.name === "channel-reader" ? `<p class="callout attention"><strong>Replace <code>CHANNEL_ID</code>.</strong> Copy the exact Discord channel ID after enabling Developer Mode. The connector will reject an unscoped channel reader.</p>` : `<p class="callout good"><strong>This first policy is read-only.</strong> Writes, Gateway access, telemetry export, and Discord-content persistence remain disabled.</p>`}
        <p class="note">Setup verifies the selected application, bot identity, and guild access before writing the file. It never stores the token value.</p>
      </div>
    </section>
    <section class="step" id="step-6">
      <div class="step-head"><div class="step-title"><span class="number">6</span><div><h2>Verify, then connect any compatible host</h2><p>Prove the policy and read-only MCP path before copying the portable stdio descriptor printed by setup.</p></div></div><label class="done"><input type="checkbox" data-step autocomplete="off" aria-label="Mark step 6 complete">Checked</label></div>
      <div class="step-body">
        <div class="command-list">${commandMarkup}</div>
        <p class="callout"><strong>Run in order.</strong> <code>${escapeHtml(validate || "")}</code> checks the strict document, <code>${escapeHtml(doctor || "")}</code> verifies Discord identity and access, and <code>${escapeHtml(smoke || "")}</code> negotiates the real MCP contract and calls only connector status.</p>
        <p>Copy the portable stdio launch descriptor from setup into any compatible MCP host. Keep the token in that host's secret facility and pass the policy with <code>--config</code> or the optional non-secret config-file selector.</p>
        <p class="note">The host runs this local process. Discord MCP supplies no shared bot, remote relay, account login, or model-specific integration.</p>
      </div>
    </section>
    <details class="evidence">
      <summary>Inspect the complete credential-free installation plan</summary>
      <div class="evidence-body"><pre tabindex="0"><code>${evidence}</code></pre></div>
    </details>
    <p id="copy-status" class="status" role="status" aria-live="polite"></p>
  </main>
  <footer><div class="shell"><p>Checklist state exists only in this open document and resets on reload. No browser was opened and Discord was not contacted when this file was generated.</p><p class="digest">${planHash}</p></div></footer>
  <script>${ONBOARDING_SCRIPT}</script>
</body>
</html>
`
}

export async function exportDiscordOnboardingHtml(
  file: string,
  plan: BotInstallPlan,
  options: DiscordOnboardingHtmlExportOptions = {},
): Promise<DiscordOnboardingHtmlExportReport> {
  const target = resolveExclusivePrivateFile(file, ONBOARDING_HTML_FILE_MESSAGES)
  const canonical = exactPlan(plan)
  const content = renderDiscordOnboardingHtml(canonical)
  await writeExclusivePrivateFile(
    target,
    content,
    ONBOARDING_HTML_FILE_MESSAGES,
    options.fileSystem,
  )
  return {
    activityRecordsCreated: false,
    automaticNetwork: "disabled",
    browserOpened: false,
    bytes: Buffer.byteLength(content),
    clientSpecificConfiguration: false,
    credentialsEmbedded: false,
    credentialsRequired: false,
    discordContacted: false,
    externalNavigationOrigins: Object.freeze(["https://discord.com"]),
    file: target,
    format: ONBOARDING_HTML_FORMAT,
    htmlDigest: `sha256:${digest(content)}`,
    planDigest: planDigest(canonical),
    schemaVersion: ONBOARDING_HTML_SCHEMA_VERSION,
    statePersistence: "disabled",
    status: "ok",
  }
}
