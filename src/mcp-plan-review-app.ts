import type {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/server"

import {
  MCP_RESOURCE_NAMES,
  MCP_RESOURCE_URIS,
} from "./mcp-guidance-catalog.js"
import {
  MCP_TOOL_CATALOG,
  type CanonicalMcpToolName,
} from "./mcp-tool-catalog.js"
import { assertMcpReadResultBudget } from "./mcp-output.js"

export const MCP_APP_EXTENSION_ID = "io.modelcontextprotocol/ui"
export const MCP_PLAN_REVIEW_APP_MIME_TYPE = "text/html;profile=mcp-app"
export const MCP_PLAN_REVIEW_APP_PROTOCOL_VERSION = "2026-01-26"
export const MCP_PLAN_REVIEW_APP_URI = MCP_RESOURCE_URIS.planReviewApp

const PLAN_TOOL_PREFIX = "plan_"
const STATIC_RESOURCE_TTL_MS = 24 * 60 * 60 * 1_000

export const MCP_PLAN_REVIEW_TOOL_NAMES = Object.freeze(
  (Object.keys(MCP_TOOL_CATALOG) as CanonicalMcpToolName[])
    .filter((name) => name.startsWith(PLAN_TOOL_PREFIX))
    .sort(),
)

const PLAN_TOOL_NAMES: ReadonlySet<string> = new Set(MCP_PLAN_REVIEW_TOOL_NAMES)

export const MCP_PLAN_REVIEW_TOOL_META = Object.freeze({
  ui: Object.freeze({
    resourceUri: MCP_PLAN_REVIEW_APP_URI,
    visibility: Object.freeze(["model"]),
  }),
})

export const MCP_PLAN_REVIEW_APP_RESOURCE_META = Object.freeze({
  ui: Object.freeze({
    csp: Object.freeze({
      baseUriDomains: Object.freeze([]),
      connectDomains: Object.freeze([]),
      frameDomains: Object.freeze([]),
      resourceDomains: Object.freeze([]),
    }),
    permissions: Object.freeze({}),
    prefersBorder: true,
  }),
})

export const MCP_PLAN_REVIEW_APP_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
  <title>Discord plan review</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: var(--color-background-primary, light-dark(#f7f8fc, #11131a));
      --panel: var(--color-background-secondary, light-dark(#ffffff, #191c25));
      --panel-soft: var(--color-background-tertiary, light-dark(#f1f3f8, #222633));
      --text: var(--color-text-primary, light-dark(#172033, #f4f6fb));
      --muted: var(--color-text-secondary, light-dark(#5e687b, #aeb7c9));
      --border: var(--color-border-secondary, light-dark(#d9deea, #343a49));
      --accent: var(--color-text-info, light-dark(#3458c8, #8da7ff));
      --safe: var(--color-text-success, light-dark(#176a49, #73d8ab));
      --warning: var(--color-text-warning, light-dark(#8b5700, #f4c26b));
      --danger: var(--color-text-danger, light-dark(#a52e35, #ff9298));
      --focus: var(--color-ring-primary, light-dark(#315bd6, #9bb2ff));
      --radius: var(--border-radius-lg, 14px);
      --mono: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
      --sans: var(--font-sans, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    }

    * { box-sizing: border-box; }

    html { background: var(--bg); }

    body {
      margin: 0;
      min-width: 260px;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.5 var(--sans);
    }

    button, input { font: inherit; }

    button:focus-visible, input:focus-visible, summary:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--focus) 55%, transparent);
      outline-offset: 2px;
    }

    .shell {
      width: min(100%, 980px);
      margin: 0 auto;
      padding: clamp(14px, 3vw, 28px);
    }

    .masthead {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 18px;
    }

    .identity { display: flex; gap: 12px; min-width: 0; }

    .mark {
      display: grid;
      width: 42px;
      height: 42px;
      flex: 0 0 auto;
      place-items: center;
      border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
      border-radius: 12px;
      background: color-mix(in srgb, var(--accent) 9%, var(--panel));
      color: var(--accent);
    }

    .mark::before {
      width: 8px;
      height: 15px;
      border-right: 3px solid currentColor;
      border-bottom: 3px solid currentColor;
      content: "";
      transform: rotate(42deg) translate(-1px, -1px);
    }

    h1 { margin: 0; font-size: clamp(19px, 3vw, 26px); line-height: 1.2; letter-spacing: -0.025em; }
    .subtitle { margin: 4px 0 0; color: var(--muted); }

    .connection {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      flex: 0 0 auto;
      padding: 6px 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--panel);
      color: var(--muted);
      font-size: 12px;
    }

    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--warning); }
    .connection[data-ready="true"] .dot { background: var(--safe); }

    .boundary {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 10px;
      margin-bottom: 16px;
      padding: 13px 15px;
      border: 1px solid color-mix(in srgb, var(--safe) 38%, var(--border));
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--safe) 7%, var(--panel));
    }

    .boundary strong { color: var(--safe); }
    .boundary p { margin: 1px 0 0; color: var(--muted); }
    .boundary-mark {
      display: grid;
      width: 19px;
      height: 19px;
      place-items: center;
      border: 1px solid color-mix(in srgb, var(--safe) 45%, var(--border));
      border-radius: 50%;
      color: var(--safe);
      font-size: 12px;
      font-weight: 800;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 16px;
    }

    .metric {
      min-width: 0;
      padding: 13px 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--panel);
    }

    .metric-label {
      display: block;
      margin-bottom: 5px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .metric-value {
      display: block;
      overflow: hidden;
      color: var(--text);
      font-weight: 720;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .metric-value.mono { font-family: var(--mono); font-size: 12px; }

    .workspace {
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--panel);
      box-shadow: 0 10px 35px color-mix(in srgb, #000 8%, transparent);
    }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      background: color-mix(in srgb, var(--panel-soft) 58%, var(--panel));
    }

    .tabs { display: flex; gap: 4px; overflow-x: auto; }

    .tab {
      border: 0;
      border-radius: 8px;
      padding: 7px 10px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font-weight: 650;
      white-space: nowrap;
    }

    .tab[aria-selected="true"] { background: var(--panel); color: var(--accent); box-shadow: inset 0 0 0 1px var(--border); }

    .filter {
      width: min(220px, 35vw);
      min-width: 110px;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 7px 9px;
      background: var(--panel);
      color: var(--text);
    }

    .filter::placeholder { color: var(--muted); }

    .panel { min-height: 260px; padding: 16px; }

    .empty {
      display: grid;
      min-height: 225px;
      place-items: center;
      color: var(--muted);
      text-align: center;
    }

    .empty strong { display: block; margin-bottom: 5px; color: var(--text); font-size: 16px; }

    .section + .section { margin-top: 18px; }
    .section h2 { margin: 0 0 9px; font-size: 14px; }

    .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }

    .field {
      min-width: 0;
      padding: 10px 11px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: color-mix(in srgb, var(--panel-soft) 44%, var(--panel));
    }

    .field-key { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .field-value { margin-top: 3px; font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; white-space: pre-wrap; }

    .notice {
      margin-bottom: 12px;
      padding: 10px 12px;
      border-left: 3px solid var(--warning);
      border-radius: 7px;
      background: color-mix(in srgb, var(--warning) 8%, var(--panel));
      color: var(--muted);
    }

    .notice[data-kind="error"] { border-left-color: var(--danger); }

    details {
      border: 1px solid var(--border);
      border-radius: 10px;
      background: color-mix(in srgb, var(--panel-soft) 34%, var(--panel));
    }

    details + details { margin-top: 8px; }
    summary { cursor: pointer; padding: 10px 12px; color: var(--text); font-weight: 650; overflow-wrap: anywhere; }
    .tree { padding: 0 12px 12px; }
    .tree-row { display: grid; grid-template-columns: minmax(130px, 34%) minmax(0, 1fr); gap: 10px; padding: 7px 0; border-top: 1px solid var(--border); }
    .tree-key { color: var(--muted); font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; }
    .tree-value { font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; white-space: pre-wrap; }

    pre {
      max-height: 520px;
      margin: 0;
      overflow: auto;
      border-radius: 10px;
      padding: 14px;
      background: color-mix(in srgb, var(--panel-soft) 66%, var(--panel));
      color: var(--text);
      font: 12px/1.55 var(--mono);
      tab-size: 2;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .footnote { margin: 12px 2px 0; color: var(--muted); font-size: 12px; }

    [hidden] { display: none !important; }

    @media (max-width: 640px) {
      .shell { padding: 12px; }
      .masthead { display: block; }
      .connection { margin-top: 12px; }
      .summary-grid { grid-template-columns: 1fr; }
      .toolbar { align-items: stretch; flex-direction: column; }
      .tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); overflow: visible; }
      .tab { padding-inline: 4px; font-size: 12px; white-space: normal; }
      .filter { width: 100%; }
      .field-grid { grid-template-columns: 1fr; }
      .tree-row { grid-template-columns: 1fr; gap: 3px; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="masthead">
      <div class="identity">
        <div class="mark" aria-hidden="true"></div>
        <div>
          <h1>Discord plan review</h1>
          <p class="subtitle" id="tool-name">Structured evidence for a reviewed change</p>
        </div>
      </div>
      <div class="connection" id="connection" data-ready="false" aria-live="polite">
        <span class="dot" aria-hidden="true"></span>
        <span id="connection-label">Connecting to host</span>
      </div>
    </header>

    <section class="boundary" aria-label="Authority boundary">
      <span class="boundary-mark" aria-hidden="true">i</span>
      <div>
        <strong>Review only</strong>
        <p>This view cannot approve, execute, modify, or retry a Discord change. Execution remains a separate signed and confirmed tool call.</p>
      </div>
    </section>

    <section class="summary-grid" aria-label="Plan summary">
      <div class="metric"><span class="metric-label">Plan status</span><span class="metric-value" id="metric-status">Waiting</span></div>
      <div class="metric"><span class="metric-label">Exact scope</span><span class="metric-value" id="metric-scope">No plan received</span></div>
      <div class="metric"><span class="metric-label">Review digest</span><span class="metric-value mono" id="metric-digest">Unavailable</span></div>
    </section>

    <section class="workspace">
      <div class="toolbar">
        <div class="tabs" role="tablist" aria-label="Review sections">
          <button class="tab" id="tab-overview" role="tab" aria-controls="review-panel" aria-selected="true" data-tab="overview" type="button">Overview</button>
          <button class="tab" id="tab-evidence" role="tab" aria-controls="review-panel" aria-selected="false" data-tab="evidence" type="button" tabindex="-1">Evidence</button>
          <button class="tab" id="tab-input" role="tab" aria-controls="review-panel" aria-selected="false" data-tab="input" type="button" tabindex="-1">Exact input</button>
          <button class="tab" id="tab-json" role="tab" aria-controls="review-panel" aria-selected="false" data-tab="json" type="button" tabindex="-1">Full JSON</button>
        </div>
        <label>
          <span hidden>Filter review fields</span>
          <input class="filter" id="filter" type="search" placeholder="Filter fields" autocomplete="off" spellcheck="false">
        </label>
      </div>
      <div class="panel" id="review-panel" role="tabpanel" aria-labelledby="tab-overview" tabindex="0">
        <div class="empty" id="empty-state">
          <div><strong>Waiting for a reviewed plan</strong>The host will deliver exact tool input and structured plan output here.</div>
        </div>
        <div id="review-content" hidden></div>
      </div>
    </section>
    <p class="footnote" id="footnote">No network, storage, clipboard, media, or server-tool authority is requested.</p>
  </main>

  <script>
    (function () {
      "use strict";

      var APP_PROTOCOL_VERSION = "2026-01-26";
      var INITIALIZE_ID = 1;
      var MAX_FIELDS = 2000;
      var state = {
        activeTab: "overview",
        cancelled: false,
        filter: "",
        hostContext: {},
        initialized: false,
        input: undefined,
        inputPartial: false,
        result: undefined
      };

      var connection = document.getElementById("connection");
      var connectionLabel = document.getElementById("connection-label");
      var content = document.getElementById("review-content");
      var empty = document.getElementById("empty-state");
      var filter = document.getElementById("filter");
      var metricDigest = document.getElementById("metric-digest");
      var metricScope = document.getElementById("metric-scope");
      var metricStatus = document.getElementById("metric-status");
      var panel = document.getElementById("review-panel");
      var tabs = Array.prototype.slice.call(document.querySelectorAll("[role=tab]"));
      var toolName = document.getElementById("tool-name");
      var resizeObserver;
      var resizeTimer;

      function isObject(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
      }

      function own(value, key) {
        return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
      }

      function scalarText(value) {
        if (value === null) return "null";
        if (value === undefined) return "unavailable";
        if (typeof value === "string") return value;
        if (typeof value === "number" || typeof value === "boolean") return String(value);
        return JSON.stringify(value);
      }

      function node(tag, className, text) {
        var element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
      }

      function post(message) {
        if (window.parent === window) return;
        window.parent.postMessage(message, "*");
      }

      function notify(method, params) {
        post({ jsonrpc: "2.0", method: method, params: params || {} });
      }

      function reply(id, result) {
        post({ jsonrpc: "2.0", id: id, result: result || {} });
      }

      function flattened(value) {
        var fields = [];
        var seen = new WeakSet();

        function visit(candidate, path, depth) {
          if (fields.length >= MAX_FIELDS) return;
          if (candidate === null || typeof candidate !== "object") {
            fields.push({ key: path || "value", value: candidate });
            return;
          }
          if (seen.has(candidate)) {
            fields.push({ key: path || "value", value: "[circular]" });
            return;
          }
          if (depth > 12) {
            fields.push({ key: path || "value", value: "[depth limit]" });
            return;
          }
          seen.add(candidate);
          if (Array.isArray(candidate)) {
            if (candidate.length === 0) fields.push({ key: path || "value", value: [] });
            candidate.forEach(function (item, index) {
              visit(item, (path ? path + "." : "") + "[" + index + "]", depth + 1);
            });
          } else {
            var keys = Object.keys(candidate).sort();
            if (keys.length === 0) fields.push({ key: path || "value", value: {} });
            keys.forEach(function (key) {
              visit(candidate[key], path ? path + "." + key : key, depth + 1);
            });
          }
        }

        visit(value, "", 0);
        return fields;
      }

      function displayPlan() {
        var structured = isObject(state.result) && own(state.result, "structuredContent")
          ? state.result.structuredContent
          : undefined;
        if (isObject(structured) && Object.keys(structured).length === 1 && isObject(structured.result)) {
          return structured.result;
        }
        return structured;
      }

      function findField(fields, patterns) {
        for (var patternIndex = 0; patternIndex < patterns.length; patternIndex += 1) {
          var pattern = patterns[patternIndex];
          for (var fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
            var field = fields[fieldIndex];
            var leaf = field.key.split(".").pop().replace(/^\[|\]$/g, "").toLowerCase();
            if (pattern.test(leaf) && field.value !== undefined) return field;
          }
        }
        return undefined;
      }

      function matchesFilter(field) {
        if (!state.filter) return true;
        var haystack = (field.key + " " + scalarText(field.value)).toLowerCase();
        return haystack.indexOf(state.filter) !== -1;
      }

      function evidenceField(field) {
        return /(blocker|warning|risk|limitation|permission|authority|evidence|scope|exact|target|digest|hash|fresh|privacy|omission|impact|effect|operation)/i.test(field.key);
      }

      function idField(field) {
        return /(^|\.)(application|bot|channel|command|emoji|event|guild|integration|interaction|invite|member|message|overwrite|role|sound|stage|sticker|target|thread|user|webhook)(Id|Ids)?$/i.test(field.key)
          || /(^|\.)(.*Ids|.*Id)(\.|$)/.test(field.key);
      }

      function renderFieldGrid(parent, fields, emptyMessage) {
        var visible = fields.filter(matchesFilter);
        if (visible.length === 0) {
          parent.appendChild(node("p", "notice", emptyMessage));
          return;
        }
        var grid = node("div", "field-grid");
        visible.forEach(function (field) {
          var card = node("div", "field");
          card.appendChild(node("div", "field-key", field.key));
          card.appendChild(node("div", "field-value", scalarText(field.value)));
          grid.appendChild(card);
        });
        parent.appendChild(grid);
      }

      function groupedFields(fields) {
        var groups = new Map();
        fields.filter(matchesFilter).forEach(function (field) {
          var first = field.key.split(".")[0] || "value";
          if (!groups.has(first)) groups.set(first, []);
          groups.get(first).push(field);
        });
        return groups;
      }

      function renderTree(parent, fields, emptyMessage) {
        var groups = groupedFields(fields);
        if (groups.size === 0) {
          parent.appendChild(node("p", "notice", emptyMessage));
          return;
        }
        groups.forEach(function (group, name) {
          var details = node("details");
          details.open = groups.size <= 4;
          details.appendChild(node("summary", "", name + " · " + group.length + (group.length === 1 ? " field" : " fields")));
          var tree = node("div", "tree");
          group.forEach(function (field) {
            var row = node("div", "tree-row");
            row.appendChild(node("div", "tree-key", field.key));
            row.appendChild(node("div", "tree-value", scalarText(field.value)));
            tree.appendChild(row);
          });
          details.appendChild(tree);
          parent.appendChild(details);
        });
      }

      function section(title) {
        var element = node("section", "section");
        element.appendChild(node("h2", "", title));
        return element;
      }

      function renderOverview(plan, fields) {
        var root = document.createDocumentFragment();
        var keyFields = [];
        var seen = new Set();
        [
          [/^status$/i],
          [/^(action|change|kind|mode|strategy)$/i],
          [/^(writeRequired|requiresApproval|destructive)$/i],
          [/^(digest|planDigest|requestDigest|operationKeyHash)$/i]
        ].forEach(function (patterns) {
          var match = findField(fields, patterns);
          if (match && !seen.has(match.key)) {
            seen.add(match.key);
            keyFields.push(match);
          }
        });
        fields.filter(idField).slice(0, 16).forEach(function (field) {
          if (!seen.has(field.key)) {
            seen.add(field.key);
            keyFields.push(field);
          }
        });
        var essentials = section("Decision essentials");
        renderFieldGrid(essentials, keyFields, "No matching essential fields in this plan");
        root.appendChild(essentials);

        var reviewFields = fields.filter(evidenceField).filter(function (field) {
          return !seen.has(field.key);
        });
        var review = section("Review signals");
        renderFieldGrid(review, reviewFields.slice(0, 36), "No matching risk, authority, or evidence fields");
        root.appendChild(review);

        var complete = section("Complete plan");
        renderTree(complete, flattened(plan), "No plan fields match the current filter");
        root.appendChild(complete);
        return root;
      }

      function renderEvidence(fields) {
        var root = document.createDocumentFragment();
        var evidence = fields.filter(evidenceField);
        var review = section("Authority, risk, and freshness evidence");
        renderTree(review, evidence, "No evidence fields match the current filter");
        root.appendChild(review);
        return root;
      }

      function renderInput() {
        var root = document.createDocumentFragment();
        var exact = section(state.inputPartial ? "Provisional tool input" : "Exact caller input");
        if (state.input === undefined) {
          exact.appendChild(node("p", "notice", "The host has not delivered tool input"));
        } else {
          renderTree(exact, flattened(state.input), "No input fields match the current filter");
        }
        root.appendChild(exact);
        return root;
      }

      function renderJson(plan) {
        var root = document.createDocumentFragment();
        var full = section("Full reviewed plan");
        var pre = node("pre");
        pre.textContent = plan === undefined ? "No structured plan received" : JSON.stringify(plan, null, 2);
        full.appendChild(pre);
        root.appendChild(full);
        var exact = section("Exact caller input");
        var inputPre = node("pre");
        inputPre.textContent = state.input === undefined ? "No tool input received" : JSON.stringify(state.input, null, 2);
        exact.appendChild(inputPre);
        root.appendChild(exact);
        return root;
      }

      function updateSummary(plan, fields) {
        var status = findField(fields, [/^status$/i]);
        var digest = findField(fields, [/^planDigest$/i, /^digest$/i, /digest$/i, /hash$/i]);
        var ids = fields.filter(idField);
        metricStatus.textContent = state.cancelled
          ? "Cancelled"
          : status ? scalarText(status.value) : plan === undefined ? "Waiting" : "Review ready";
        metricScope.textContent = ids.length === 0
          ? plan === undefined ? "No plan received" : "No exact IDs reported"
          : ids.length + (ids.length === 1 ? " exact ID field" : " exact ID fields");
        metricDigest.textContent = digest ? scalarText(digest.value) : "Unavailable";
        metricDigest.title = digest ? scalarText(digest.value) : "";
      }

      function render() {
        var plan = displayPlan();
        var fields = flattened(plan);
        updateSummary(plan, fields);
        content.replaceChildren();

        if (plan === undefined && state.input === undefined && !state.cancelled) {
          empty.hidden = false;
          content.hidden = true;
          return;
        }

        empty.hidden = true;
        content.hidden = false;
        if (state.cancelled) {
          var cancelled = node("p", "notice", "Tool execution was cancelled. No write was authorized by this review view.");
          cancelled.dataset.kind = "error";
          content.appendChild(cancelled);
        }
        if (state.activeTab === "overview") content.appendChild(renderOverview(plan, fields));
        if (state.activeTab === "evidence") content.appendChild(renderEvidence(fields));
        if (state.activeTab === "input") content.appendChild(renderInput());
        if (state.activeTab === "json") content.appendChild(renderJson(plan));
      }

      function selectTab(nextTab, focus) {
        state.activeTab = nextTab;
        tabs.forEach(function (tab) {
          var selected = tab.dataset.tab === nextTab;
          tab.setAttribute("aria-selected", String(selected));
          tab.tabIndex = selected ? 0 : -1;
          if (selected && focus) tab.focus();
        });
        var selectedTab = tabs.find(function (tab) { return tab.dataset.tab === nextTab; });
        if (selectedTab) panel.setAttribute("aria-labelledby", selectedTab.id);
        filter.hidden = nextTab === "json";
        render();
      }

      function applyHostContext(candidate) {
        if (!isObject(candidate)) return;
        state.hostContext = Object.assign(Object.create(null), state.hostContext, candidate);
        if (candidate.theme === "light" || candidate.theme === "dark") {
          document.documentElement.dataset.theme = candidate.theme;
          document.documentElement.style.colorScheme = candidate.theme;
        }
        var toolInfo = isObject(state.hostContext.toolInfo) ? state.hostContext.toolInfo : undefined;
        var tool = toolInfo && isObject(toolInfo.tool) ? toolInfo.tool : undefined;
        if (tool && typeof tool.name === "string") {
          toolName.textContent = tool.title && typeof tool.title === "string"
            ? tool.title + " · " + tool.name
            : tool.name;
        }
      }

      function completeInitialization(result) {
        if (state.initialized) return;
        state.initialized = true;
        applyHostContext(isObject(result) ? result.hostContext : undefined);
        connection.dataset.ready = "true";
        connectionLabel.textContent = "Review host connected";
        notify("ui/notifications/initialized", {});
        announceSize();
      }

      function announceSize() {
        if (!state.initialized) return;
        var body = document.body;
        notify("ui/notifications/size-changed", {
          height: Math.ceil(body.scrollHeight),
          width: Math.ceil(body.scrollWidth)
        });
      }

      function receive(event) {
        if (event.source !== window.parent || !isObject(event.data) || event.data.jsonrpc !== "2.0") return;
        var message = event.data;
        if (message.id === INITIALIZE_ID && isObject(message.result)) {
          completeInitialization(message.result);
          return;
        }
        if (message.method === "ping" && own(message, "id")) {
          reply(message.id, {});
          return;
        }
        if (message.method === "ui/resource-teardown" && own(message, "id")) {
          reply(message.id, {});
          connection.dataset.ready = "false";
          connectionLabel.textContent = "Review closed";
          window.removeEventListener("message", receive);
          window.clearTimeout(resizeTimer);
          if (resizeObserver) resizeObserver.disconnect();
          return;
        }
        if (message.method === "ui/notifications/tool-input-partial") {
          state.input = isObject(message.params) ? message.params.arguments : undefined;
          state.inputPartial = true;
          render();
          return;
        }
        if (message.method === "ui/notifications/tool-input") {
          state.input = isObject(message.params) ? message.params.arguments : undefined;
          state.inputPartial = false;
          render();
          return;
        }
        if (message.method === "ui/notifications/tool-result") {
          state.result = message.params;
          state.cancelled = false;
          render();
          return;
        }
        if (message.method === "ui/notifications/tool-cancelled") {
          state.cancelled = true;
          render();
          return;
        }
        if (message.method === "ui/notifications/host-context-changed") {
          applyHostContext(message.params);
        }
      }

      tabs.forEach(function (tab, index) {
        tab.addEventListener("click", function () { selectTab(tab.dataset.tab, false); });
        tab.addEventListener("keydown", function (event) {
          var nextIndex = index;
          if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
          else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
          else if (event.key === "Home") nextIndex = 0;
          else if (event.key === "End") nextIndex = tabs.length - 1;
          else return;
          event.preventDefault();
          selectTab(tabs[nextIndex].dataset.tab, true);
        });
      });

      filter.addEventListener("input", function () {
        state.filter = filter.value.trim().toLowerCase();
        render();
      });

      window.addEventListener("message", receive);
      if (typeof ResizeObserver === "function") {
        resizeObserver = new ResizeObserver(function () {
          window.clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(announceSize, 80);
        });
        resizeObserver.observe(document.body);
      }

      post({
        jsonrpc: "2.0",
        id: INITIALIZE_ID,
        method: "ui/initialize",
        params: {
          appCapabilities: { availableDisplayModes: ["inline"] },
          appInfo: { name: "discord-mcp-plan-review", version: "1.0.0" },
          protocolVersion: APP_PROTOCOL_VERSION
        }
      });
    }());
  </script>
</body>
</html>`

export function isPlanReviewToolName(
  name: string,
): name is CanonicalMcpToolName {
  return PLAN_TOOL_NAMES.has(name)
}

export function attachPlanReviewApp(
  name: CanonicalMcpToolName,
  tool: RegisteredTool,
): void {
  if (!isPlanReviewToolName(name)) return
  tool.update({
    _meta: {
      ...tool._meta,
      ...MCP_PLAN_REVIEW_TOOL_META,
    },
  })
}

export function registerDiscordPlanReviewApp(
  server: McpServer,
  mcpReadResponseMaxBytes: number,
): void {
  server.registerResource(
    MCP_RESOURCE_NAMES.planReviewApp,
    MCP_PLAN_REVIEW_APP_URI,
    {
      _meta: MCP_PLAN_REVIEW_APP_RESOURCE_META,
      cacheHint: {
        cacheScope: "public",
        ttlMs: STATIC_RESOURCE_TTL_MS,
      },
      description: "Display-only interactive review of exact Discord change plans without approval or execution authority.",
      mimeType: MCP_PLAN_REVIEW_APP_MIME_TYPE,
      title: "Discord plan review",
    },
    async (uri) => assertMcpReadResultBudget({
      contents: [{
        _meta: MCP_PLAN_REVIEW_APP_RESOURCE_META,
        mimeType: MCP_PLAN_REVIEW_APP_MIME_TYPE,
        text: MCP_PLAN_REVIEW_APP_HTML,
        uri: uri.href,
      }],
    }, mcpReadResponseMaxBytes, "resource"),
  )
}
