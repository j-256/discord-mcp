import { createHash } from "node:crypto"
import {
  lstat,
  realpath,
} from "node:fs/promises"
import {
  basename,
  dirname,
} from "node:path"

import {
  CONFIG_DOCUMENT_SCHEMA_ID,
  CONFIG_DOCUMENT_SCHEMA_VERSION,
  connectorConfigFields,
  connectorConfigJsonSchema,
  type ConfigDocumentField,
  type ConnectorConfigDocument,
} from "./config-document.js"
import {
  resolveConnectorConfigFile,
  showConnectorConfigFile,
  validateConnectorConfigDocumentPolicy,
} from "./config-operator.js"
import { CONNECTOR_NAME, CONNECTOR_VERSION, MCP_TOOLSET_NAMES } from "./constants.js"
import { ConfigurationError } from "./errors.js"
import {
  DEFAULT_EXCLUSIVE_PRIVATE_FILE_SYSTEM,
  resolveExclusivePrivateFile,
  writeExclusivePrivateFile,
  type ExclusivePrivateFileSystem,
} from "./exclusive-private-file.js"
import { stableString } from "./normalize.js"

export const CONFIG_WORKBENCH_HTML_FORMAT = "discord-mcp.config-workbench-html.v1"
export const CONFIG_WORKBENCH_HTML_SCHEMA_VERSION = 1

const CONFIG_WORKBENCH_TOP_LEVEL_ORDER = Object.freeze([
  "$schema",
  "capabilities",
  "credential",
  "gateway",
  "identity",
  "limits",
  "name",
  "observability",
  "readScope",
  "runtime",
  "schemaVersion",
  "scopes",
  "storage",
  "tools",
] as const)

const CONFIG_WORKBENCH_GROUPS = Object.freeze([
  { description: "Format, policy name, external credential reference, and immutable Discord identity", id: "identity", label: "Identity and format" },
  { description: "Exact guild boundary and optional exact channel boundary", id: "read", label: "Read boundary" },
  { description: "Advertised MCP surface and risk-separated toolsets", id: "tools", label: "Tool surface" },
  { description: "Optional privacy-safe real-time connection and bounded event memory", id: "gateway", label: "Gateway" },
  { description: "Independent opt-in audit and write gates", id: "capabilities", label: "Capabilities" },
  { description: "Exact Discord IDs that constrain each feature", id: "scopes", label: "Feature scopes" },
  { description: "Bounded interaction, upload, and queue controls", id: "limits", label: "Limits" },
  { description: "Content-free state and caller-owned local input roots", id: "storage", label: "Local storage" },
  { description: "Non-secret runtime behavior", id: "runtime", label: "Runtime" },
  { description: "Content-free local and OTLP diagnostics", id: "observability", label: "Observability" },
] as const)

type ConfigWorkbenchGroupId = typeof CONFIG_WORKBENCH_GROUPS[number]["id"]

interface JsonSchemaNode {
  const?: unknown
  description?: string
  enum?: readonly unknown[]
  items?: JsonSchemaNode
  maximum?: number
  maxItems?: number
  maxLength?: number
  minimum?: number
  minItems?: number
  minLength?: number
  oneOf?: readonly JsonSchemaNode[]
  pattern?: string
  properties?: Record<string, JsonSchemaNode>
  required?: readonly string[]
  type?: string
}

interface ConfigWorkbenchConstraint {
  enumValues?: readonly string[]
  maximum?: number
  maxItems?: number
  maxLength?: number
  minimum?: number
  minItems?: number
  minLength?: number
  pattern?: string
  referenceProviders?: readonly {
    field: "path" | "variable"
    maximumLength?: number
    minimumLength?: number
    pattern?: string
    provider: "environment" | "file"
  }[]
}

export interface ConfigWorkbenchField extends ConfigDocumentField {
  readonly constraints: ConfigWorkbenchConstraint
  readonly editable: boolean
  readonly group: ConfigWorkbenchGroupId
}

export interface DiscordConfigWorkbenchModel {
  readonly activeDocument: ConnectorConfigDocument
  readonly activeDocumentDigest: string
  readonly activeFile: string
  readonly candidateFilename: string
  readonly connectorName: string
  readonly connectorVersion: string
  readonly fields: readonly ConfigWorkbenchField[]
  readonly format: typeof CONFIG_WORKBENCH_HTML_FORMAT
  readonly groups: typeof CONFIG_WORKBENCH_GROUPS
  readonly platform: NodeJS.Platform
  readonly schemaDigest: string
  readonly schemaId: string
  readonly schemaVersion: typeof CONFIG_WORKBENCH_HTML_SCHEMA_VERSION
  readonly topLevelOrder: typeof CONFIG_WORKBENCH_TOP_LEVEL_ORDER
  readonly toolsets: readonly string[]
}

export interface DiscordConfigWorkbenchHtmlExportReport {
  readonly activeConfigurationWritten: false
  readonly activeDocumentDigest: string
  readonly activeFile: string
  readonly automaticNetwork: "disabled"
  readonly browserOpened: false
  readonly bytes: number
  readonly candidateAuthority: "explicit-download-only"
  readonly candidateFilename: string
  readonly configurationEmbedded: true
  readonly credentialsEmbedded: false
  readonly discordContacted: false
  readonly externalNavigationOrigins: readonly []
  readonly file: string
  readonly format: typeof CONFIG_WORKBENCH_HTML_FORMAT
  readonly htmlDigest: string
  readonly outputFileCreated: true
  readonly schemaDigest: string
  readonly schemaVersion: typeof CONFIG_WORKBENCH_HTML_SCHEMA_VERSION
  readonly secretValuesRead: false
  readonly statePersistence: "disabled"
  readonly status: "ok"
}

export interface ConfigWorkbenchDirectoryMetadata {
  readonly mode: number
  readonly uid: number
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

export interface ConfigWorkbenchFileSystem extends ExclusivePrivateFileSystem {
  lstat(path: string): Promise<ConfigWorkbenchDirectoryMetadata>
  realpath(path: string): Promise<string>
}

export interface DiscordConfigWorkbenchHtmlExportOptions {
  readonly fileSystem?: ConfigWorkbenchFileSystem
  readonly platform?: NodeJS.Platform
  readonly processUserId?: number
}

const DEFAULT_CONFIG_WORKBENCH_FILE_SYSTEM: ConfigWorkbenchFileSystem = {
  ...DEFAULT_EXCLUSIVE_PRIVATE_FILE_SYSTEM,
  lstat,
  realpath,
}

const CONFIG_WORKBENCH_HTML_FILE_MESSAGES = Object.freeze({
  exists: "Configuration workbench target already exists; choose a new path or move the existing file",
  failure: "Configuration workbench could not be written",
  invalidPath: "Configuration workbench requires a valid output file path",
})

const WORKBENCH_SCRIPT = String.raw`(function () {
  'use strict';
  const host = document.getElementById('workbench-data');
  const fatal = document.getElementById('fatal');
  const main = document.getElementById('main');
  const groupsHost = document.getElementById('field-groups');
  const navigation = document.getElementById('group-navigation');
  const search = document.getElementById('field-search');
  const filter = document.getElementById('field-filter');
  const filterStatus = document.getElementById('filter-status');
  const changedCount = document.getElementById('changed-count');
  const errorCount = document.getElementById('error-count');
  const enabledCount = document.getElementById('enabled-count');
  const scopedCount = document.getElementById('scoped-count');
  const impactSummary = document.getElementById('impact-summary');
  const diffList = document.getElementById('diff-list');
  const diffEmpty = document.getElementById('diff-empty');
  const preview = document.getElementById('candidate-preview');
  const download = document.getElementById('download-candidate');
  const copy = document.getElementById('copy-candidate');
  const copyStatus = document.getElementById('copy-status');
  const resetAll = document.getElementById('reset-all');
  const activeDigest = document.getElementById('active-digest');
  const schemaDigest = document.getElementById('schema-digest');
  const activeFile = document.getElementById('active-file');
  const candidateName = document.getElementById('candidate-name');
  const planCommand = document.getElementById('plan-command');
  const applyCommand = document.getElementById('apply-command');
  const skip = document.querySelector('.skip-link');
  const controls = new Map();
  const errors = new Map();
  const cards = [];
  const groupSections = [];
  let payload;
  let original;
  let draft;

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const decode = (value) => {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  const pathParts = (path) => path.replace(/^\$\.?/, '').split('.').filter(Boolean);
  const getAt = (target, path) => pathParts(path).reduce((value, key) => value == null ? undefined : value[key], target);
  const setAt = (target, path, value) => {
    const keys = pathParts(path);
    let current = target;
    keys.forEach((key, index) => {
      if (index === keys.length - 1) current[key] = value;
      else {
        if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) current[key] = {};
        current = current[key];
      }
    });
  };
  const deleteAt = (target, path) => {
    const keys = pathParts(path);
    const parents = [];
    let current = target;
    for (let index = 0; index < keys.length - 1; index += 1) {
      if (!current || typeof current !== 'object') return;
      parents.push([current, keys[index]]);
      current = current[keys[index]];
    }
    if (current && typeof current === 'object') delete current[keys[keys.length - 1]];
    for (let index = parents.length - 1; index >= 0; index -= 1) {
      const parent = parents[index][0];
      const key = parents[index][1];
      const value = parent[key];
      if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) delete parent[key];
      else break;
    }
  };
  const humanize = (value) => value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/Ids$/, ' IDs')
    .replace(/Id$/, ' ID')
    .replace(/^./, (character) => character.toUpperCase());
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const arrayText = (value) => Array.isArray(value) ? value.join('\n') : '';
  const parseLines = (value) => value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  const uniqueSorted = (values) => Array.from(new Set(values)).sort();
  const appendText = (parent, tag, value, className) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    parent.append(element);
    return element;
  };
  const exactValue = (field, value) => {
    if (field.path === '$.tools.toolsets') {
      const selected = new Set(Array.isArray(value) ? value : []);
      return payload.toolsets.filter((entry) => selected.has(entry));
    }
    if (field.kind === 'snowflakes' || field.kind === 'paths' || field.kind === 'strings') {
      return uniqueSorted(Array.isArray(value) ? value : []);
    }
    return value;
  };
  const optionalEmpty = (field, value) => {
    if (field.required) return false;
    if (value === undefined || value === null || value === '') return true;
    if (Array.isArray(value) && value.length === 0) return true;
    if (field.kind === 'boolean' && value === false) return true;
    return false;
  };
  const canonicalDocument = (source) => {
    const target = {};
    const sections = new Set(['capabilities', 'gateway', 'identity', 'limits', 'observability', 'readScope', 'runtime', 'scopes', 'storage', 'tools']);
    payload.topLevelOrder.forEach((top) => {
      if (sections.has(top)) target[top] = {};
    });
    payload.fields.forEach((field) => {
      let value = exactValue(field, getAt(source, field.path));
      if (field.path === '$.$schema') value = payload.schemaId;
      if (field.path === '$.schemaVersion') value = 2;
      if (field.path === '$.identity.applicationId' || field.path === '$.identity.botId') value = getAt(original, field.path);
      if (optionalEmpty(field, value)) return;
      setAt(target, field.path, clone(value));
    });
    const ordered = {};
    payload.topLevelOrder.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(target, key)) ordered[key] = target[key];
    });
    return ordered;
  };
  const candidateJson = () => JSON.stringify(canonicalDocument(draft), null, 2) + '\n';
  const duplicateValues = (values) => values.filter((value, index) => values.indexOf(value) !== index);
  const absoluteCanonicalPath = (value) => {
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) return false;
    if (payload.platform === 'win32') {
      if (!/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(value)) return false;
      return !/(?:^|[\\/])\.\.?(?:[\\/]|$)/.test(value) && !/[\\/]{2,}/.test(value.replace(/^\\\\/, ''));
    }
    return value.startsWith('/') && !/(?:^|\/)\.\.?(?:\/|$)/.test(value) && !/\/\//.test(value);
  };
  const patternError = (pattern, value, label) => pattern && !(new RegExp(pattern)).test(value) ? label : '';
  const validateField = (field, value, raw) => {
    const found = [];
    const constraints = field.constraints || {};
    if (field.required && (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0))) found.push('A value is required');
    if (value === undefined || value === null || value === '') return found;
    if (field.kind === 'snowflake') {
      const message = patternError(constraints.pattern, String(value), 'Enter one valid Discord snowflake');
      if (message) found.push(message);
    }
    if (field.kind === 'snowflakes' || field.kind === 'paths' || field.kind === 'strings') {
      const values = Array.isArray(value) ? value : [];
      if (duplicateValues(raw || values).length > 0) found.push('Remove duplicate values');
      if (constraints.minItems !== undefined && values.length < constraints.minItems) found.push('Add at least ' + constraints.minItems + ' value');
      if (constraints.maxItems !== undefined && values.length > constraints.maxItems) found.push('Use no more than ' + constraints.maxItems + ' values');
      if (field.kind === 'snowflakes' && constraints.pattern && values.some((entry) => !(new RegExp(constraints.pattern)).test(entry))) found.push('Every entry must be a Discord snowflake');
      if (field.kind === 'paths' && values.some((entry) => !absoluteCanonicalPath(entry))) found.push('Every entry must be an absolute canonical path');
      if (field.path === '$.tools.toolsets' && values.some((entry) => !payload.toolsets.includes(entry))) found.push('Select only known toolsets');
    }
    if (field.kind === 'path' && !absoluteCanonicalPath(String(value))) found.push('Enter an absolute canonical path');
    if (field.kind === 'integer' || field.kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) found.push('Enter a finite number');
      else {
        if (field.kind === 'integer' && !Number.isInteger(value)) found.push('Enter a whole number');
        if (constraints.minimum !== undefined && value < constraints.minimum) found.push('Use a value of at least ' + constraints.minimum);
        if (constraints.maximum !== undefined && value > constraints.maximum) found.push('Use a value no greater than ' + constraints.maximum);
      }
    }
    if (field.kind === 'string') {
      const text = String(value);
      const message = patternError(constraints.pattern, text, 'Value does not match the required format');
      if (message) found.push(message);
      if (constraints.minLength !== undefined && text.length < constraints.minLength) found.push('Use at least ' + constraints.minLength + ' character');
      if (constraints.maxLength !== undefined && text.length > constraints.maxLength) found.push('Use no more than ' + constraints.maxLength + ' characters');
      if (constraints.enumValues && !constraints.enumValues.includes(text)) found.push('Select one supported value');
    }
    if (field.kind === 'secret-reference') {
      const provider = constraints.referenceProviders && constraints.referenceProviders.find((entry) => entry.provider === value.provider);
      if (!provider) found.push('Select a supported reference provider');
      else {
        const reference = String(value[provider.field] || '');
        if (!reference) found.push('Enter the external ' + provider.field + ' reference');
        const message = patternError(provider.pattern, reference, 'Reference does not match the required format');
        if (message) found.push(message);
        if (provider.minimumLength !== undefined && reference.length < provider.minimumLength) found.push('Reference is too short');
        if (provider.maximumLength !== undefined && reference.length > provider.maximumLength) found.push('Reference is too long');
        if (provider.field === 'path' && reference && !absoluteCanonicalPath(reference)) found.push('Enter an absolute canonical credential path');
      }
    }
    return found;
  };
  const setFieldValue = (field, value, raw) => {
    const normalized = exactValue(field, value);
    if (optionalEmpty(field, normalized)) deleteAt(draft, field.path);
    else setAt(draft, field.path, normalized);
    errors.set(field.path, validateField(field, normalized, raw));
    update();
  };
  const fieldLabel = (field) => humanize(pathParts(field.path).slice(-1)[0] || field.path);
  const createInput = (field, value) => {
    const control = document.createElement('div');
    control.className = 'control';
    if (field.kind === 'boolean') {
      const label = document.createElement('label');
      label.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = value === true;
      input.disabled = !field.editable;
      input.setAttribute('aria-label', fieldLabel(field));
      const text = document.createElement('span');
      text.textContent = input.checked ? 'Enabled' : 'Disabled';
      input.addEventListener('change', () => {
        text.textContent = input.checked ? 'Enabled' : 'Disabled';
        setFieldValue(field, input.checked);
      });
      label.append(input, text);
      control.append(label);
    } else if (field.path === '$.tools.toolsets') {
      const selected = new Set(Array.isArray(value) ? value : []);
      const list = document.createElement('div');
      list.className = 'choice-grid';
      const inputs = [];
      payload.toolsets.forEach((toolset) => {
        const label = document.createElement('label');
        label.className = 'choice';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = selected.has(toolset);
        input.disabled = !field.editable;
        const text = document.createElement('span');
        text.textContent = toolset;
        input.addEventListener('change', () => setFieldValue(field, inputs.filter((entry) => entry.checked).map((entry) => entry.value)));
        input.value = toolset;
        inputs.push(input);
        label.append(input, text);
        list.append(label);
      });
      control.append(list);
    } else if (field.kind === 'snowflakes' || field.kind === 'paths' || field.kind === 'strings') {
      const input = document.createElement('textarea');
      input.rows = Math.min(8, Math.max(3, Array.isArray(value) ? value.length + 1 : 3));
      input.value = arrayText(value);
      input.disabled = !field.editable;
      input.spellcheck = false;
      input.placeholder = 'One value per line';
      input.setAttribute('aria-label', fieldLabel(field));
      input.addEventListener('input', () => {
        const lines = parseLines(input.value);
        setFieldValue(field, lines, lines);
      });
      control.append(input);
    } else if (field.kind === 'secret-reference') {
      const providers = field.constraints.referenceProviders || [];
      const optional = !field.required;
      const enabledLabel = document.createElement('label');
      enabledLabel.className = 'reference-enabled';
      const enabled = document.createElement('input');
      enabled.type = 'checkbox';
      enabled.checked = value !== undefined;
      enabled.disabled = !field.editable;
      const enabledText = document.createElement('span');
      enabledText.textContent = 'Reference configured';
      if (optional) enabledLabel.append(enabled, enabledText);
      const row = document.createElement('div');
      row.className = 'reference-row';
      const provider = document.createElement('select');
      providers.forEach((entry) => {
        const option = document.createElement('option');
        option.value = entry.provider;
        option.textContent = entry.provider === 'environment' ? 'Environment variable' : 'External file';
        provider.append(option);
      });
      provider.value = value && value.provider ? value.provider : providers[0] && providers[0].provider;
      provider.disabled = !field.editable || providers.length < 2 || (optional && !enabled.checked);
      provider.setAttribute('aria-label', fieldLabel(field) + ' reference provider');
      const reference = document.createElement('input');
      reference.type = 'text';
      const descriptor = () => providers.find((entry) => entry.provider === provider.value) || providers[0];
      reference.value = value ? String(value.variable || value.path || '') : '';
      reference.disabled = !field.editable || (optional && !enabled.checked);
      reference.spellcheck = false;
      const updateReference = () => {
        const selected = descriptor();
        reference.placeholder = selected && selected.field === 'path' ? '/absolute/path/to/secret' : 'EXTERNAL_SECRET_REFERENCE';
        reference.setAttribute('aria-label', fieldLabel(field) + ' external ' + (selected ? selected.field : 'reference'));
        if (optional && !enabled.checked) setFieldValue(field, undefined);
        else setFieldValue(field, selected ? { provider: selected.provider, [selected.field]: reference.value.trim() } : undefined);
      };
      enabled.addEventListener('change', () => {
        provider.disabled = !field.editable || providers.length < 2 || !enabled.checked;
        reference.disabled = !field.editable || !enabled.checked;
        updateReference();
      });
      provider.addEventListener('change', () => {
        reference.value = '';
        updateReference();
        reference.focus();
      });
      reference.addEventListener('input', updateReference);
      row.append(provider, reference);
      if (optional) control.append(enabledLabel);
      control.append(row);
      const initialDescriptor = descriptor();
      reference.placeholder = initialDescriptor && initialDescriptor.field === 'path' ? '/absolute/path/to/secret' : 'EXTERNAL_SECRET_REFERENCE';
      reference.setAttribute('aria-label', fieldLabel(field) + ' external ' + (initialDescriptor ? initialDescriptor.field : 'reference'));
    } else {
      const input = field.constraints.enumValues ? document.createElement('select') : document.createElement('input');
      if (input instanceof HTMLInputElement) {
        input.type = field.kind === 'integer' || field.kind === 'number' ? 'number' : 'text';
        if (field.kind === 'number') input.step = 'any';
        if (field.kind === 'integer') input.step = '1';
        if (field.constraints.minimum !== undefined) input.min = String(field.constraints.minimum);
        if (field.constraints.maximum !== undefined) input.max = String(field.constraints.maximum);
        input.spellcheck = false;
      } else {
        field.constraints.enumValues.forEach((entry) => {
          const option = document.createElement('option');
          option.value = entry;
          option.textContent = entry;
          input.append(option);
        });
      }
      input.value = value === undefined ? '' : String(value);
      input.disabled = !field.editable;
      input.setAttribute('aria-label', fieldLabel(field));
      const read = () => {
        if ((field.kind === 'integer' || field.kind === 'number') && input.value !== '') return Number(input.value);
        return input.value.trim();
      };
      input.addEventListener('input', () => setFieldValue(field, read()));
      input.addEventListener('change', () => setFieldValue(field, read()));
      control.append(input);
    }
    return control;
  };
  const renderField = (field) => {
    const card = document.createElement('article');
    card.className = 'field-card';
    card.dataset.path = field.path;
    card.dataset.search = (field.path + ' ' + field.description + ' ' + field.group).toLowerCase();
    const heading = document.createElement('div');
    heading.className = 'field-heading';
    const title = document.createElement('div');
    appendText(title, 'h3', fieldLabel(field));
    appendText(title, 'code', field.path, 'field-path');
    const badges = document.createElement('div');
    badges.className = 'badges';
    if (field.required) appendText(badges, 'span', 'required', 'badge');
    if (!field.editable) appendText(badges, 'span', 'locked', 'badge locked');
    heading.append(title, badges);
    card.append(heading);
    appendText(card, 'p', field.description, 'field-description');
    const value = getAt(draft, field.path);
    card.append(createInput(field, value));
    const actions = document.createElement('div');
    actions.className = 'field-actions';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'quiet';
    reset.textContent = 'Reset field';
    reset.disabled = !field.editable;
    reset.addEventListener('click', () => {
      const originalValue = getAt(original, field.path);
      if (originalValue === undefined) deleteAt(draft, field.path);
      else setAt(draft, field.path, clone(originalValue));
      initializeErrors();
      renderAllFields();
      update();
    });
    const defaultText = field.defaultValue === undefined ? 'No default' : 'Default: ' + JSON.stringify(field.defaultValue);
    appendText(actions, 'span', defaultText, 'default-value');
    actions.append(reset);
    card.append(actions);
    const error = appendText(card, 'p', '', 'field-error');
    error.setAttribute('role', 'status');
    controls.set(field.path, { card, error });
    cards.push(card);
    return card;
  };
  const renderAllFields = () => {
    controls.clear();
    cards.length = 0;
    groupSections.length = 0;
    groupsHost.replaceChildren();
    navigation.replaceChildren();
    payload.groups.forEach((group) => {
      const section = document.createElement('section');
      section.className = 'field-group';
      section.id = 'group-' + group.id;
      section.dataset.group = group.id;
      const heading = document.createElement('div');
      heading.className = 'section-heading';
      const text = document.createElement('div');
      appendText(text, 'p', group.id, 'eyebrow');
      appendText(text, 'h2', group.label);
      appendText(text, 'p', group.description, 'section-description');
      const count = appendText(heading, 'span', '', 'section-count');
      heading.prepend(text);
      section.append(heading);
      const grid = document.createElement('div');
      grid.className = group.id === 'capabilities' ? 'field-grid compact' : 'field-grid';
      const fields = payload.fields.filter((field) => field.group === group.id);
      fields.forEach((field) => grid.append(renderField(field)));
      count.textContent = fields.length + ' fields';
      section.append(grid);
      groupsHost.append(section);
      groupSections.push(section);
      const link = document.createElement('button');
      link.type = 'button';
      link.textContent = group.label;
      link.addEventListener('click', () => section.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      navigation.append(link);
    });
  };
  const differenceDirection = (field, before, after) => {
    const path = field.path;
    if (path.startsWith('$.capabilities.')) return after === true ? 'potential expansion' : 'potential reduction';
    if (path === '$.gateway.enabled') return after === true ? 'potential expansion' : 'potential reduction';
    if (path === '$.tools.surface') return after === 'full' ? 'potential expansion' : 'potential reduction';
    const arrays = path.startsWith('$.scopes.') || path.startsWith('$.readScope.') || path === '$.tools.toolsets';
    if (arrays) {
      const oldValues = Array.isArray(before) ? before : [];
      const newValues = Array.isArray(after) ? after : [];
      if (path === '$.readScope.channelIds' && oldValues.length !== newValues.length && (oldValues.length === 0 || newValues.length === 0)) return newValues.length === 0 ? 'potential expansion' : 'potential reduction';
      const added = newValues.some((value) => !oldValues.includes(value));
      const removed = oldValues.some((value) => !newValues.includes(value));
      const inverse = path === '$.scopes.protectedUserIds';
      if (added && removed) return 'redistribution';
      if (added) return inverse ? 'potential reduction' : 'potential expansion';
      if (removed) return inverse ? 'potential expansion' : 'potential reduction';
    }
    if (path === '$.limits.interactionMaxWritesPerMinute' && typeof before === 'number' && typeof after === 'number') return after > before ? 'potential expansion' : 'potential reduction';
    if (path === '$.limits.interactionMinWriteIntervalMs' && typeof before === 'number' && typeof after === 'number') return after < before ? 'potential expansion' : 'potential reduction';
    return 'authoritative plan required';
  };
  const differences = () => payload.fields.flatMap((field) => {
    const before = exactValue(field, getAt(canonicalDocument(original), field.path));
    const after = exactValue(field, getAt(canonicalDocument(draft), field.path));
    return equal(before, after) ? [] : [{ after, before, direction: differenceDirection(field, before, after), field }];
  });
  const activeValue = (value) => value === true || (Array.isArray(value) && value.length > 0) || (value && typeof value === 'object' && Object.keys(value).length > 0) || (value !== undefined && value !== null && value !== '' && typeof value !== 'object');
  const applyFilters = () => {
    const query = search.value.trim().toLowerCase();
    const mode = filter.value;
    const changed = new Set(differences().map((entry) => entry.field.path));
    let visible = 0;
    cards.forEach((card) => {
      const record = controls.get(card.dataset.path);
      const fieldErrors = errors.get(card.dataset.path) || [];
      const matchesSearch = !query || (card.dataset.search || '').includes(query);
      const matchesMode = mode === 'all'
        || (mode === 'changed' && changed.has(card.dataset.path))
        || (mode === 'enabled' && activeValue(getAt(draft, card.dataset.path)))
        || (mode === 'errors' && fieldErrors.length > 0);
      card.hidden = !(matchesSearch && matchesMode);
      if (!card.hidden) visible += 1;
      if (record) record.card.dataset.changed = String(changed.has(card.dataset.path));
    });
    groupSections.forEach((section) => {
      section.hidden = !Array.from(section.querySelectorAll('.field-card')).some((card) => !card.hidden);
    });
    filterStatus.textContent = visible + ' of ' + cards.length + ' fields shown';
  };
  const renderDiff = (items) => {
    diffList.replaceChildren();
    diffEmpty.hidden = items.length !== 0;
    const directionCounts = new Map();
    items.forEach((item) => {
      directionCounts.set(item.direction, (directionCounts.get(item.direction) || 0) + 1);
      const row = document.createElement('li');
      const heading = document.createElement('div');
      heading.className = 'diff-heading';
      appendText(heading, 'code', item.field.path);
      appendText(heading, 'span', item.direction, 'impact ' + item.direction.replaceAll(' ', '-'));
      row.append(heading);
      appendText(row, 'p', 'Before: ' + JSON.stringify(item.before));
      appendText(row, 'p', 'After: ' + JSON.stringify(item.after));
      diffList.append(row);
    });
    impactSummary.textContent = items.length === 0
      ? 'No local changes. The downloaded candidate would match the active policy.'
      : Array.from(directionCounts.entries()).map((entry) => entry[1] + ' ' + entry[0]).join(' | ') + '. These labels are preliminary; config plan is authoritative.';
  };
  const update = () => {
    payload.fields.forEach((field) => {
      if (!errors.has(field.path)) errors.set(field.path, validateField(field, getAt(draft, field.path)));
      const record = controls.get(field.path);
      if (!record) return;
      const fieldErrors = errors.get(field.path) || [];
      record.error.textContent = fieldErrors.join('. ');
      record.error.hidden = fieldErrors.length === 0;
      record.card.dataset.error = String(fieldErrors.length > 0);
    });
    const items = differences();
    const totalErrors = Array.from(errors.values()).reduce((count, value) => count + (value.length > 0 ? 1 : 0), 0);
    const candidate = canonicalDocument(draft);
    changedCount.textContent = String(items.length);
    errorCount.textContent = String(totalErrors);
    enabledCount.textContent = String(Object.values(candidate.capabilities || {}).filter(Boolean).length);
    scopedCount.textContent = String(Object.values(candidate.scopes || {}).filter((value) => Array.isArray(value) && value.length > 0).length);
    preview.value = JSON.stringify(candidate, null, 2) + '\n';
    download.disabled = totalErrors > 0;
    download.setAttribute('aria-describedby', totalErrors > 0 ? 'download-blocked' : 'download-ready');
    document.getElementById('download-blocked').hidden = totalErrors === 0;
    document.getElementById('download-ready').hidden = totalErrors > 0;
    renderDiff(items);
    applyFilters();
  };
  const initializeErrors = () => {
    errors.clear();
    payload.fields.forEach((field) => errors.set(field.path, validateField(field, getAt(draft, field.path))));
  };
  try {
    payload = decode(host.dataset.payload || '');
    original = clone(payload.activeDocument);
    draft = clone(payload.activeDocument);
    activeDigest.textContent = payload.activeDocumentDigest;
    schemaDigest.textContent = payload.schemaDigest;
    activeFile.textContent = payload.activeFile;
    candidateName.textContent = payload.candidateFilename;
    planCommand.textContent = JSON.stringify({ command: payload.connectorName, args: ['config', 'plan', payload.activeFile, payload.candidateFilename, '--json'] });
    applyCommand.textContent = JSON.stringify({ command: payload.connectorName, args: ['config', 'apply', payload.activeFile, payload.candidateFilename, '--plan-digest', 'PLAN_DIGEST', '--confirm', payload.activeDocument.name] });
    initializeErrors();
    renderAllFields();
    update();
    search.addEventListener('input', applyFilters);
    filter.addEventListener('change', applyFilters);
    resetAll.addEventListener('click', () => {
      draft = clone(original);
      initializeErrors();
      renderAllFields();
      update();
      copyStatus.textContent = 'All fields reset to the validated active policy';
    });
    download.addEventListener('click', () => {
      if (download.disabled) return;
      const blob = new Blob([candidateJson()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = payload.candidateFilename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      copyStatus.textContent = 'Candidate download requested. The active configuration was not changed.';
    });
    copy.addEventListener('click', async () => {
      let copied = false;
      try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard API unavailable');
        await navigator.clipboard.writeText(candidateJson());
        copied = true;
      } catch {
        preview.focus();
        preview.select();
        copied = document.execCommand('copy');
        preview.setSelectionRange(0, 0);
      }
      copyStatus.textContent = copied ? 'Candidate JSON copied' : 'Copy was unavailable; select the candidate preview manually';
    });
    skip.addEventListener('click', (event) => {
      event.preventDefault();
      main.focus();
      main.scrollIntoView();
    });
  } catch (error) {
    fatal.hidden = false;
    fatal.textContent = 'The embedded workbench model could not be loaded. Generate a fresh workbench from the validated active configuration.';
    main.hidden = true;
  }
})();`

const WORKBENCH_STYLE = `:root{--bg:#f4f5f8;--panel:#fff;--panel-2:#f8f9fc;--ink:#171a27;--muted:#5c6475;--line:#d9dde7;--brand:#5865f2;--brand-2:#3e48bd;--good:#087b61;--warn:#9a5700;--danger:#b52d45;--focus:#d26b00;--shadow:0 18px 55px rgba(29,34,54,.09)}@media(prefers-color-scheme:dark){:root{--bg:#0c1018;--panel:#151b27;--panel-2:#101620;--ink:#f1f3fb;--muted:#aab2c3;--line:#303849;--brand:#98a0ff;--brand-2:#5865f2;--good:#6bd7b9;--warn:#ffc06d;--danger:#ff8999;--focus:#ffd166;--shadow:0 18px 55px rgba(0,0,0,.35)}}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}.shell{width:min(1320px,calc(100% - 2rem));margin:0 auto}.skip-link{position:fixed;z-index:50;top:-5rem;left:1rem;padding:.7rem 1rem;border:2px solid var(--focus);border-radius:.7rem;background:var(--panel);color:var(--ink)}.skip-link:focus{top:1rem}.hero{padding:4rem 0 2rem}.eyebrow{margin:0;color:var(--brand);font-size:.72rem;font-weight:850;letter-spacing:.14em;text-transform:uppercase}.hero h1{max-width:980px;margin:.55rem 0 0;font-size:clamp(2.5rem,7vw,6rem);line-height:.94;letter-spacing:-.058em}.lede{max-width:850px;margin:1.25rem 0 0;color:var(--muted);font-size:clamp(1rem,2vw,1.2rem)}.proofs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin:2rem 0}.proof,.panel,.field-card{min-width:0;border:1px solid var(--line);border-radius:1rem;background:var(--panel);box-shadow:var(--shadow)}.proof{padding:1rem}.proof strong{display:block;overflow-wrap:anywhere;font-size:1.3rem}.proof span{color:var(--muted);font-size:.76rem}.boundary{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.panel{padding:1.2rem}.panel h2{margin-top:0}.checks{display:grid;grid-template-columns:1fr 1fr;gap:.55rem;margin:0;padding:0;list-style:none}.checks li{padding:.66rem;border-radius:.65rem;background:var(--panel-2)}.checks li::before{content:"OK";display:inline-block;margin-right:.4rem;color:var(--good);font-size:.62rem;font-weight:900}.workflow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem;margin-top:1rem}.step{padding:.85rem;border:1px solid var(--line);border-radius:.75rem;background:var(--panel-2)}.step strong{display:block}.step span{color:var(--muted);font-size:.8rem}.sticky{position:sticky;z-index:20;top:0;border-block:1px solid var(--line);background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(16px)}.toolbar{display:grid;grid-template-columns:minmax(15rem,1fr) minmax(11rem,.35fr) auto;gap:.7rem;padding:.75rem 0}.toolbar label{display:grid;gap:.25rem;color:var(--muted);font-size:.68rem;font-weight:800;text-transform:uppercase}.toolbar input,.toolbar select{min-width:0;min-height:2.65rem;padding:.55rem .7rem;border:1px solid var(--line);border-radius:.65rem;background:var(--panel);color:var(--ink);font:inherit;text-transform:none}.toolbar button,.actions button,.quiet,.nav-scroll button{min-height:2.65rem;padding:.55rem .8rem;border:1px solid var(--line);border-radius:.65rem;background:var(--panel);color:var(--ink);font:inherit;font-size:.78rem;font-weight:800;cursor:pointer}.toolbar button:hover,.actions button:hover,.quiet:hover,.nav-scroll button:hover{border-color:var(--brand);color:var(--brand)}.nav-scroll{display:flex;gap:.45rem;overflow:auto;padding:0 0 .75rem}.nav-scroll button{min-height:2.2rem;white-space:nowrap}.filter-line{display:flex;justify-content:space-between;gap:1rem;padding:0 0 .65rem;color:var(--muted);font-size:.78rem}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:2px}button:disabled{cursor:not-allowed;opacity:.52}main{padding:2rem 0 5rem;scroll-margin-top:11rem}.overview{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.7rem}.metric{padding:1rem;border:1px solid var(--line);border-radius:.85rem;background:var(--panel)}.metric strong{display:block;font-size:1.65rem}.metric span{color:var(--muted);font-size:.75rem}.field-group{scroll-margin-top:11rem;margin-top:2.5rem}.section-heading{display:flex;align-items:end;justify-content:space-between;gap:1rem;margin-bottom:1rem}.section-heading h2{margin:.2rem 0;font-size:clamp(1.7rem,4vw,2.7rem);letter-spacing:-.035em}.section-description{margin:0;color:var(--muted)}.section-count{color:var(--muted);white-space:nowrap}.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.field-grid.compact{grid-template-columns:repeat(3,minmax(0,1fr))}.field-card{display:flex;flex-direction:column;padding:1rem}.field-card[data-changed="true"]{border-color:var(--brand);box-shadow:0 0 0 1px var(--brand),var(--shadow)}.field-card[data-error="true"]{border-color:var(--danger)}.field-heading{display:flex;align-items:start;justify-content:space-between;gap:.7rem}.field-heading h3{margin:0;font-size:1rem}.field-path{display:block;margin-top:.2rem;color:var(--muted);font-size:.7rem;overflow-wrap:anywhere}.badges{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.3rem}.badge,.impact{display:inline-block;padding:.22rem .42rem;border:1px solid var(--line);border-radius:999px;background:var(--panel-2);font-size:.62rem;font-weight:850}.badge.locked{color:var(--warn)}.field-description{margin:.65rem 0;color:var(--muted);font-size:.82rem}.control{margin-top:auto}.control input[type="text"],.control input[type="number"],.control select,.control textarea{width:100%;min-height:2.55rem;padding:.55rem .65rem;border:1px solid var(--line);border-radius:.6rem;background:var(--panel-2);color:var(--ink);font:inherit;font-size:.84rem}.control textarea{resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;line-height:1.45}.control input:disabled,.control select:disabled,.control textarea:disabled{opacity:.72}.switch,.reference-enabled,.choice{display:flex;align-items:center;gap:.55rem}.switch{min-height:2.55rem;padding:.55rem .65rem;border:1px solid var(--line);border-radius:.6rem;background:var(--panel-2);font-weight:750}.choice-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.4rem;max-height:19rem;overflow:auto;padding:.45rem;border:1px solid var(--line);border-radius:.65rem;background:var(--panel-2)}.choice{min-width:0;padding:.38rem;border-radius:.45rem;font-size:.73rem}.choice span{overflow-wrap:anywhere}.reference-enabled{margin-bottom:.45rem;font-size:.78rem}.reference-row{display:grid;grid-template-columns:minmax(12rem,.45fr) minmax(0,1fr);gap:.45rem}.field-actions{display:flex;align-items:center;justify-content:space-between;gap:.7rem;margin-top:.65rem}.field-actions .quiet{min-height:2rem;padding:.35rem .5rem}.default-value{color:var(--muted);font-size:.68rem}.field-error{margin:.6rem 0 0;padding:.55rem;border-radius:.55rem;background:color-mix(in srgb,var(--danger) 10%,var(--panel));color:var(--danger);font-size:.76rem;font-weight:750}.review-grid{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:1rem;margin-top:3rem}.review-grid .panel{box-shadow:none}.diff-list{display:grid;gap:.55rem;margin:1rem 0 0;padding:0;list-style:none;max-height:35rem;overflow:auto}.diff-list li{padding:.7rem;border:1px solid var(--line);border-radius:.65rem;background:var(--panel-2)}.diff-list p{margin:.35rem 0 0;color:var(--muted);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.7rem;overflow-wrap:anywhere}.diff-heading{display:flex;align-items:start;justify-content:space-between;gap:.5rem}.diff-heading code{overflow-wrap:anywhere}.impact.potential-expansion{color:var(--danger)}.impact.potential-reduction{color:var(--good)}.impact.redistribution{color:var(--warn)}.candidate-preview{width:100%;height:34rem;padding:.8rem;border:1px solid var(--line);border-radius:.7rem;background:var(--panel-2);color:var(--ink);font: .72rem/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;resize:vertical}.actions{display:flex;flex-wrap:wrap;gap:.55rem;margin-top:.7rem}.actions .primary{border-color:var(--brand-2);background:var(--brand-2);color:#fff}.status{min-height:1.5rem;color:var(--good);font-size:.8rem}.blocked{color:var(--danger)}.command-list{display:grid;gap:.6rem;margin-top:1rem}.command{padding:.7rem;border:1px solid var(--line);border-radius:.65rem;background:var(--panel-2)}.command code,.digest{overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.72rem}.muted{color:var(--muted)}.fatal{margin:2rem auto;padding:1rem;border:2px solid var(--danger);border-radius:.8rem;background:var(--panel);color:var(--danger)}footer{padding:2rem 0 4rem;border-top:1px solid var(--line);color:var(--muted);font-size:.8rem}@media(max-width:980px){.field-grid.compact{grid-template-columns:repeat(2,minmax(0,1fr))}.proofs,.overview{grid-template-columns:repeat(2,minmax(0,1fr))}.boundary,.review-grid{grid-template-columns:minmax(0,1fr)}}@media(max-width:700px){.shell{width:min(100% - 1rem,1320px)}.hero{padding-top:2.7rem}.toolbar{grid-template-columns:minmax(0,1fr)}.workflow,.field-grid,.field-grid.compact,.proofs,.overview,.checks{grid-template-columns:minmax(0,1fr)}.section-heading,.field-heading,.diff-heading,.field-actions{align-items:stretch;flex-direction:column}.badges{justify-content:flex-start}.choice-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.reference-row{grid-template-columns:minmax(0,1fr)}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}`

function digest(value: string, encoding: "base64" | "hex" = "hex"): string {
  return createHash("sha256").update(value).digest(encoding)
}

function schemaAtPath(schema: JsonSchemaNode, path: string): JsonSchemaNode {
  const keys = path.replace(/^\$\.?/, "").split(".").filter(Boolean)
  let current = schema
  for (const key of keys) {
    current = current.properties?.[key] || {}
  }
  return current
}

function referenceProviders(schema: JsonSchemaNode): ConfigWorkbenchConstraint["referenceProviders"] {
  const alternatives = schema.oneOf || [schema]
  return alternatives.flatMap((alternative) => {
    const provider = alternative.properties?.provider?.const
    if (provider !== "environment" && provider !== "file") return []
    const field = provider === "file" ? "path" : "variable"
    const reference = alternative.properties?.[field] || {}
    return [{
      field,
      ...(reference.maxLength === undefined ? {} : { maximumLength: reference.maxLength }),
      ...(reference.minLength === undefined ? {} : { minimumLength: reference.minLength }),
      ...(reference.pattern === undefined ? {} : { pattern: reference.pattern }),
      provider,
    }]
  })
}

function fieldConstraints(
  field: ConfigDocumentField,
  schema: JsonSchemaNode,
): ConfigWorkbenchConstraint {
  const fieldSchema = schemaAtPath(schema, field.path)
  const valueSchema = field.kind === "snowflakes"
    || field.kind === "paths"
    || field.kind === "strings"
    ? fieldSchema.items || {}
    : fieldSchema
  const enumSource = fieldSchema.enum || valueSchema.enum
  return Object.freeze({
    ...(enumSource
      ? { enumValues: Object.freeze(enumSource.filter((value): value is string => typeof value === "string")) }
      : {}),
    ...(fieldSchema.maximum === undefined ? {} : { maximum: fieldSchema.maximum }),
    ...(fieldSchema.maxItems === undefined ? {} : { maxItems: fieldSchema.maxItems }),
    ...(valueSchema.maxLength === undefined ? {} : { maxLength: valueSchema.maxLength }),
    ...(fieldSchema.minimum === undefined ? {} : { minimum: fieldSchema.minimum }),
    ...(fieldSchema.minItems === undefined ? {} : { minItems: fieldSchema.minItems }),
    ...(valueSchema.minLength === undefined ? {} : { minLength: valueSchema.minLength }),
    ...(valueSchema.pattern === undefined ? {} : { pattern: valueSchema.pattern }),
    ...(field.kind === "secret-reference"
      ? { referenceProviders: Object.freeze(referenceProviders(fieldSchema) || []) }
      : {}),
  })
}

function fieldGroup(path: string): ConfigWorkbenchGroupId {
  if (path.startsWith("$.capabilities.")) return "capabilities"
  if (path.startsWith("$.scopes.")) return "scopes"
  if (path.startsWith("$.readScope.")) return "read"
  if (path.startsWith("$.tools.")) return "tools"
  if (path.startsWith("$.gateway.")) return "gateway"
  if (path.startsWith("$.limits.")) return "limits"
  if (path.startsWith("$.storage.")) return "storage"
  if (path.startsWith("$.runtime.")) return "runtime"
  if (path.startsWith("$.observability.")) return "observability"
  return "identity"
}

function workbenchFields(): readonly ConfigWorkbenchField[] {
  const schema = connectorConfigJsonSchema() as JsonSchemaNode
  return Object.freeze(connectorConfigFields().map((field) => Object.freeze({
    ...field,
    constraints: fieldConstraints(field, schema),
    editable: ![
      "$.$schema",
      "$.identity.applicationId",
      "$.identity.botId",
      "$.schemaVersion",
    ].includes(field.path),
    group: fieldGroup(field.path),
  })))
}

function trimFilenameSeparators(value: string): string {
  let start = 0
  let end = value.length
  while (start < end && (value[start] === "." || value[start] === "-")) start += 1
  while (end > start && (value[end - 1] === "." || value[end - 1] === "-")) end -= 1
  return value.slice(start, end)
}

function suggestedCandidateFilename(activeFile: string): string {
  const sanitizedStem = basename(activeFile)
    .replace(/\.json$/iu, "")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .slice(0, 96)
  const stem = trimFilenameSeparators(sanitizedStem)
  return `${stem || "discord-mcp"}.candidate.json`
}

export function createDiscordConfigWorkbenchModel(
  activeFile: string,
  documentValue: ConnectorConfigDocument,
  platform: NodeJS.Platform = process.platform,
): DiscordConfigWorkbenchModel {
  const file = resolveConnectorConfigFile(activeFile)
  const activeDocument = validateConnectorConfigDocumentPolicy(documentValue)
  const schema = connectorConfigJsonSchema()
  return Object.freeze({
    activeDocument,
    activeDocumentDigest: `sha256:${digest(stableString(activeDocument))}`,
    activeFile: file,
    candidateFilename: suggestedCandidateFilename(file),
    connectorName: CONNECTOR_NAME,
    connectorVersion: CONNECTOR_VERSION,
    fields: workbenchFields(),
    format: CONFIG_WORKBENCH_HTML_FORMAT,
    groups: CONFIG_WORKBENCH_GROUPS,
    platform,
    schemaDigest: `sha256:${digest(stableString(schema))}`,
    schemaId: CONFIG_DOCUMENT_SCHEMA_ID,
    schemaVersion: CONFIG_WORKBENCH_HTML_SCHEMA_VERSION,
    topLevelOrder: CONFIG_WORKBENCH_TOP_LEVEL_ORDER,
    toolsets: MCP_TOOLSET_NAMES,
  })
}

export function renderDiscordConfigWorkbenchHtml(
  model: DiscordConfigWorkbenchModel,
): string {
  if (
    model.format !== CONFIG_WORKBENCH_HTML_FORMAT
    || model.schemaVersion !== CONFIG_WORKBENCH_HTML_SCHEMA_VERSION
    || model.schemaId !== CONFIG_DOCUMENT_SCHEMA_ID
    || model.activeDocument.schemaVersion !== CONFIG_DOCUMENT_SCHEMA_VERSION
  ) {
    throw new ConfigurationError("Configuration workbench requires an exact validated schema-v2 model")
  }
  const verified = createDiscordConfigWorkbenchModel(
    model.activeFile,
    model.activeDocument,
    model.platform,
  )
  if (stableString(verified) !== stableString(model)) {
    throw new ConfigurationError("Configuration workbench model does not match the current schema contract")
  }
  const scriptHash = digest(WORKBENCH_SCRIPT, "base64")
  const styleHash = digest(WORKBENCH_STYLE, "base64")
  const payload = Buffer.from(JSON.stringify(model), "utf8").toString("base64")
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; img-src 'none'; manifest-src 'none'; media-src 'none'; object-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; worker-src 'none'; require-trusted-types-for 'script'">
  <meta name="description" content="Private offline Discord MCP configuration workbench">
  <title>Discord MCP configuration workbench</title>
  <style>${WORKBENCH_STYLE}</style>
</head>
<body>
  <a class="skip-link" href="#main">Skip to policy fields</a>
  <div id="workbench-data" data-payload="${payload}" hidden></div>
  <header class="shell hero">
    <p class="eyebrow">Private offline policy editor</p>
    <h1>Shape authority. Review every expansion.</h1>
    <p class="lede">Edit one validated non-secret schema-v2 policy in memory, then download a candidate. This page cannot resolve a token, contact Discord, replace the active file, or approve its own changes.</p>
    <div class="proofs" role="list" aria-label="Workbench boundaries">
      <div class="proof" role="listitem"><strong>Offline</strong><span>No automatic network or external navigation</span></div>
      <div class="proof" role="listitem"><strong>Memory only</strong><span>No browser storage, cookies, or hidden state</span></div>
      <div class="proof" role="listitem"><strong>Candidate only</strong><span>Explicit download cannot replace the active policy</span></div>
      <div class="proof" role="listitem"><strong>Plan required</strong><span>CLI validation and semantic review remain authoritative</span></div>
    </div>
    <div class="boundary">
      <section class="panel" aria-labelledby="privacy-title"><h2 id="privacy-title">Contained by design</h2><ul class="checks"><li>No secret-value field</li><li>No Discord or MCP request</li><li>No active-file write</li><li>No generic JSON dispatch</li><li>No browser persistence</li><li>No model or client dependency</li></ul></section>
      <section class="panel" aria-labelledby="workflow-title"><h2 id="workflow-title">Reviewed replacement</h2><div class="workflow"><div class="step"><strong>1. Edit</strong><span>Make local changes and download a candidate</span></div><div class="step"><strong>2. Plan</strong><span>Review exact semantic impact, tools, warnings, and digest</span></div><div class="step"><strong>3. Apply</strong><span>Fresh-check both files and explicitly confirm replacement</span></div></div></section>
    </div>
  </header>
  <section class="sticky" aria-label="Policy navigation and filters">
    <div class="shell toolbar">
      <label>Search policy fields<input id="field-search" type="search" placeholder="Path, description, or domain" autocomplete="off"></label>
      <label>Show<select id="field-filter"><option value="all">All fields</option><option value="changed">Changed fields</option><option value="enabled">Configured or enabled</option><option value="errors">Fields with errors</option></select></label>
      <button id="reset-all" type="button">Reset all fields</button>
    </div>
    <nav id="group-navigation" class="shell nav-scroll" aria-label="Policy sections"></nav>
    <div class="shell filter-line"><span id="filter-status" role="status" aria-live="polite"></span><span>Local labels are preliminary. <strong>config plan is authoritative.</strong></span></div>
  </section>
  <p id="fatal" class="shell fatal" role="alert" hidden></p>
  <main id="main" class="shell" tabindex="-1">
    <section class="overview" aria-label="Candidate summary">
      <div class="metric"><strong id="changed-count">0</strong><span>Changed fields</span></div>
      <div class="metric"><strong id="error-count">0</strong><span>Local field errors</span></div>
      <div class="metric"><strong id="enabled-count">0</strong><span>Enabled capabilities</span></div>
      <div class="metric"><strong id="scoped-count">0</strong><span>Configured feature scopes</span></div>
    </section>
    <div id="field-groups"></div>
    <section class="review-grid" aria-label="Candidate review">
      <div class="panel">
        <p class="eyebrow">Local diff</p>
        <h2>What changed</h2>
        <p id="impact-summary" class="muted"></p>
        <p id="diff-empty" class="muted">No fields differ from the validated active policy.</p>
        <ul id="diff-list" class="diff-list"></ul>
      </div>
      <div class="panel">
        <p class="eyebrow">Complete candidate</p>
        <h2 id="candidate-name"></h2>
        <textarea id="candidate-preview" class="candidate-preview" readonly spellcheck="false" aria-label="Complete candidate JSON"></textarea>
        <div class="actions"><button id="download-candidate" class="primary" type="button">Download candidate</button><button id="copy-candidate" type="button">Copy candidate JSON</button></div>
        <p id="download-ready" class="status">Candidate download is available. The active file will not be changed.</p>
        <p id="download-blocked" class="status blocked" hidden>Resolve local field errors before downloading. CLI policy validation is still required afterward.</p>
        <p id="copy-status" class="status" role="status" aria-live="polite"></p>
      </div>
    </section>
    <section class="panel" aria-labelledby="next-title">
      <p class="eyebrow">Authoritative next steps</p>
      <h2 id="next-title">Plan before replacement</h2>
      <p>This page performs basic field checks only. The CLI re-parses the complete document, enforces every cross-field policy invariant, locks the Discord identity, computes exact tool exposure and semantic impact, and binds the review to both file paths and bytes.</p>
      <div class="command-list"><div class="command"><strong>Plan argv</strong><br><code id="plan-command"></code></div><div class="command"><strong>Apply argv after review</strong><br><code id="apply-command"></code></div></div>
      <p class="digest"><strong>Active file</strong><br><span id="active-file"></span><br><br><strong>Active document</strong><br><span id="active-digest"></span><br><br><strong>Schema contract</strong><br><span id="schema-digest"></span></p>
    </section>
  </main>
  <noscript><p class="shell fatal">This offline workbench requires local JavaScript. It still makes no network request.</p></noscript>
  <footer><div class="shell">${CONFIG_WORKBENCH_HTML_FORMAT} | ${CONNECTOR_NAME} ${CONNECTOR_VERSION} | Private operator artifact | Delete it when no longer needed</div></footer>
  <script>${WORKBENCH_SCRIPT}</script>
</body>
</html>
`
}

async function assertPrivateOutputDirectory(
  file: string,
  fileSystem: ConfigWorkbenchFileSystem,
  platform: NodeJS.Platform,
  processUserId: number | undefined,
): Promise<void> {
  const directory = dirname(file)
  let metadata: ConfigWorkbenchDirectoryMetadata
  let canonical: string
  try {
    [metadata, canonical] = await Promise.all([
      fileSystem.lstat(directory),
      fileSystem.realpath(directory),
    ])
  } catch (error) {
    throw new ConfigurationError(
      "Configuration workbench output directory could not be inspected",
      { cause: error },
    )
  }
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || canonical !== directory
    || (
      platform !== "win32"
      && (
        processUserId === undefined
        || metadata.uid !== processUserId
        || (metadata.mode & 0o022) !== 0
      )
    )
  ) {
    throw new ConfigurationError(
      "Configuration workbench output directory must be canonical, owned by the process user, and not group or world writable",
    )
  }
}

export async function exportDiscordConfigWorkbenchHtml(
  activeFile: string,
  outputFile: string,
  options: DiscordConfigWorkbenchHtmlExportOptions = {},
): Promise<DiscordConfigWorkbenchHtmlExportReport> {
  const active = showConnectorConfigFile(activeFile)
  const platform = options.platform || process.platform
  const model = createDiscordConfigWorkbenchModel(active.file, active.document, platform)
  const content = renderDiscordConfigWorkbenchHtml(model)
  const file = resolveExclusivePrivateFile(
    outputFile,
    CONFIG_WORKBENCH_HTML_FILE_MESSAGES,
  )
  const fileSystem = options.fileSystem || DEFAULT_CONFIG_WORKBENCH_FILE_SYSTEM
  const processUserId = options.processUserId === undefined
    ? typeof process.getuid === "function" ? process.getuid() : undefined
    : options.processUserId
  await assertPrivateOutputDirectory(file, fileSystem, platform, processUserId)
  await writeExclusivePrivateFile(
    file,
    content,
    CONFIG_WORKBENCH_HTML_FILE_MESSAGES,
    fileSystem,
  )
  return Object.freeze({
    activeConfigurationWritten: false,
    activeDocumentDigest: model.activeDocumentDigest,
    activeFile: model.activeFile,
    automaticNetwork: "disabled",
    browserOpened: false,
    bytes: Buffer.byteLength(content),
    candidateAuthority: "explicit-download-only",
    candidateFilename: model.candidateFilename,
    configurationEmbedded: true,
    credentialsEmbedded: false,
    discordContacted: false,
    externalNavigationOrigins: Object.freeze([]) as readonly [],
    file,
    format: CONFIG_WORKBENCH_HTML_FORMAT,
    htmlDigest: `sha256:${digest(content)}`,
    outputFileCreated: true,
    schemaDigest: model.schemaDigest,
    schemaVersion: CONFIG_WORKBENCH_HTML_SCHEMA_VERSION,
    secretValuesRead: false,
    statePersistence: "disabled",
    status: "ok",
  })
}
