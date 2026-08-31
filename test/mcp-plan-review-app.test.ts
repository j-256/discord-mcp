import assert from "node:assert/strict"
import test from "node:test"
import vm from "node:vm"

import {
  Client,
  InMemoryTransport,
} from "@modelcontextprotocol/client"

import { createDiscordCatalogServer } from "../src/catalog.js"
import {
  MCP_APP_EXTENSION_ID,
  MCP_PLAN_REVIEW_APP_HTML,
  MCP_PLAN_REVIEW_APP_MIME_TYPE,
  MCP_PLAN_REVIEW_APP_PROTOCOL_VERSION,
  MCP_PLAN_REVIEW_APP_RESOURCE_META,
  MCP_PLAN_REVIEW_APP_URI,
  MCP_PLAN_REVIEW_TOOL_META,
  MCP_PLAN_REVIEW_TOOL_NAMES,
} from "../src/mcp-plan-review-app.js"
import { MCP_TOOL_CATALOG } from "../src/mcp-tool-catalog.js"

interface FakeElement {
  appendChild(child: FakeElement): FakeElement
  children: FakeElement[]
  className: string
  dataset: Record<string, string>
  hidden: boolean
  id: string
  listeners: Map<string, (event: Record<string, unknown>) => void>
  open: boolean
  replaceChildren(...children: FakeElement[]): void
  setAttribute(name: string, value: string): void
  style: Record<string, string>
  tabIndex: number
  textContent: string
  title: string
  value: string
}

function fakeElement(id = ""): FakeElement {
  const attributes = new Map<string, string>()
  const element: FakeElement & {
    addEventListener(name: string, listener: (event: Record<string, unknown>) => void): void
    focus(): void
  } = {
    addEventListener(name, listener) {
      element.listeners.set(name, listener)
    },
    appendChild(child) {
      element.children.push(child)
      return child
    },
    children: [],
    className: "",
    dataset: {},
    focus() {},
    hidden: false,
    id,
    listeners: new Map(),
    open: false,
    replaceChildren(...children) {
      element.children = children
    },
    setAttribute(name, value) {
      attributes.set(name, value)
    },
    style: {},
    tabIndex: 0,
    textContent: "",
    title: "",
    value: "",
  }
  Object.defineProperty(element, "innerHTML", {
    get() {
      throw new Error("innerHTML must not be read")
    },
    set() {
      throw new Error("innerHTML must not be written")
    },
  })
  return element
}

function appScript(): string {
  const match = /<script>([\s\S]*)<\/script>\s*<\/body>/.exec(MCP_PLAN_REVIEW_APP_HTML)
  assert.ok(match?.[1])
  return match[1]
}

function plainJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

async function withCatalogClient(
  callback: (client: Client) => Promise<void>,
): Promise<void> {
  const server = createDiscordCatalogServer()
  const client = new Client(
    { name: "plan-review-app-test", version: "1.0.0" },
    { capabilities: {} },
  )
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    await callback(client)
  } finally {
    await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }
}

test("plan-review app binds every and only canonical plan tool", () => {
  const canonicalNames = Object.keys(MCP_TOOL_CATALOG).sort()
  const expected = canonicalNames.filter((name) => name.startsWith("plan_"))

  assert.deepEqual(MCP_PLAN_REVIEW_TOOL_NAMES, expected)
  assert.ok(MCP_PLAN_REVIEW_TOOL_NAMES.length > 0)
  assert.deepEqual(MCP_PLAN_REVIEW_TOOL_META, {
    ui: {
      resourceUri: MCP_PLAN_REVIEW_APP_URI,
      visibility: ["model"],
    },
  })
  assert.equal(Object.hasOwn(MCP_PLAN_REVIEW_TOOL_META, "ui/resourceUri"), false)
})

test("plan-review app is a self-contained display-only MCP App document", () => {
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /^<!doctype html>/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /connect-src 'none'/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /frame-src 'none'/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /object-src 'none'/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /base-uri 'none'/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /Review only/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /Change impact/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /Exact targets and names/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /Permission and decision/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /Evidence and coordination details/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /cannot approve, execute, modify, or retry/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /prefers-reduced-motion/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /role="tablist"/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /aria-live="polite"/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /event\.source !== window\.parent/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /ui\/initialize/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /ui\/notifications\/initialized/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /ui\/notifications\/tool-input/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /ui\/notifications\/tool-result/)
  assert.match(MCP_PLAN_REVIEW_APP_HTML, /ui\/resource-teardown/)
  assert.doesNotMatch(MCP_PLAN_REVIEW_APP_HTML, /<script\s+src=/)
  assert.doesNotMatch(MCP_PLAN_REVIEW_APP_HTML, /<link\b/)
  assert.doesNotMatch(MCP_PLAN_REVIEW_APP_HTML, /url\(https?:/)
  assert.doesNotMatch(MCP_PLAN_REVIEW_APP_HTML, /\.innerHTML|insertAdjacentHTML|document\.write/)
  assert.doesNotMatch(MCP_PLAN_REVIEW_APP_HTML, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/)
  assert.doesNotMatch(MCP_PLAN_REVIEW_APP_HTML, /localStorage|sessionStorage|indexedDB|document\.cookie/)
  assert.doesNotMatch(MCP_PLAN_REVIEW_APP_HTML, /navigator\.clipboard|window\.open/)
  assert.doesNotMatch(MCP_PLAN_REVIEW_APP_HTML, /tools\/call|resources\/read/)
  assert.doesNotMatch(MCP_PLAN_REVIEW_APP_HTML, /<a\s|<form/)
  assert.deepEqual(MCP_PLAN_REVIEW_APP_RESOURCE_META, {
    ui: {
      csp: {
        baseUriDomains: [],
        connectDomains: [],
        frameDomains: [],
        resourceDomains: [],
      },
      permissions: {},
      prefersBorder: true,
    },
  })
})

test("plan-review app completes a display-only host lifecycle without trusted HTML sinks", () => {
  const elements = new Map<string, FakeElement>()
  const elementIds = [
    "connection",
    "connection-label",
    "review-content",
    "empty-state",
    "filter",
    "footnote",
    "metric-decision",
    "metric-impact",
    "metric-target",
    "review-panel",
    "tool-name",
  ]
  for (const id of elementIds) elements.set(id, fakeElement(id))
  const tabs = ["overview", "evidence", "input", "json"].map((name) => {
    const tab = fakeElement(`tab-${name}`)
    tab.dataset.tab = name
    return tab
  })
  const created: FakeElement[] = []
  const posted: unknown[] = []
  const parent = {
    postMessage(message: unknown) {
      posted.push(message)
    },
  }
  let messageListener: ((event: {
    data: unknown
    source: unknown
  }) => void) | undefined
  const windowObject = {
    clearTimeout,
    parent,
    setTimeout,
    addEventListener(name: string, listener: typeof messageListener) {
      if (name === "message") messageListener = listener
    },
    removeEventListener(name: string, listener: typeof messageListener) {
      if (name === "message" && messageListener === listener) messageListener = undefined
    },
  }
  const body = fakeElement("body") as FakeElement & {
    scrollHeight: number
    scrollWidth: number
  }
  body.scrollHeight = 640
  body.scrollWidth = 800
  const documentObject = {
    body,
    createDocumentFragment() {
      const fragment = fakeElement()
      created.push(fragment)
      return fragment
    },
    createElement(tag: string) {
      const element = fakeElement(tag)
      created.push(element)
      return element
    },
    documentElement: fakeElement("html"),
    getElementById(id: string) {
      const element = elements.get(id)
      assert.ok(element, id)
      return element
    },
    querySelectorAll() {
      return tabs
    },
  }
  vm.runInNewContext(appScript(), {
    document: documentObject,
    window: windowObject,
  })
  assert.ok(messageListener)
  assert.deepEqual(plainJson(posted[0]), {
    id: 1,
    jsonrpc: "2.0",
    method: "ui/initialize",
    params: {
      appCapabilities: { availableDisplayModes: ["inline"] },
      appInfo: { name: "guildcontrol-plan-review", version: "1.0.0" },
      protocolVersion: MCP_PLAN_REVIEW_APP_PROTOCOL_VERSION,
    },
  })

  messageListener({
    data: {
      id: 1,
      jsonrpc: "2.0",
      result: {
        hostCapabilities: {},
        hostContext: {
          theme: "dark",
          toolInfo: {
            tool: {
              name: "plan_message_deletion",
              title: "Plan message deletion",
            },
          },
        },
        hostInfo: { name: "test-host", version: "1.0.0" },
        protocolVersion: MCP_PLAN_REVIEW_APP_PROTOCOL_VERSION,
      },
    },
    source: parent,
  })
  assert.deepEqual(plainJson(posted[1]), {
    jsonrpc: "2.0",
    method: "ui/notifications/initialized",
    params: {},
  })
  assert.deepEqual(plainJson(posted[2]), {
    jsonrpc: "2.0",
    method: "ui/notifications/size-changed",
    params: { height: 640, width: 800 },
  })
  assert.equal(elements.get("connection")?.dataset.ready, "true")
  assert.equal(elements.get("tool-name")?.textContent, "Plan message deletion · plan_message_deletion")

  const hostile = `</script><img src=x onerror="alert('review')">`
  messageListener({
    data: {
      jsonrpc: "2.0",
      method: "ui/notifications/tool-input",
      params: { arguments: { channelId: hostile } },
    },
    source: parent,
  })
  messageListener({
    data: {
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: {
        content: [{ text: "Review ready", type: "text" }],
        structuredContent: {
          exactTarget: { channelId: hostile, messageIds: ["300000000000000001"] },
          planDigest: "sha256:test",
          status: "ok",
          unknownFutureField: hostile,
          warnings: [hostile],
        },
      },
    },
    source: parent,
  })
  assert.equal(elements.get("metric-decision")?.textContent, "ok")
  assert.equal(elements.get("metric-impact")?.textContent, "Review the exact change")
  assert.equal(elements.get("metric-target")?.textContent, "2 exact ID fields")
  assert.ok(created.some((element) => element.textContent === hostile))
  assert.ok(created.some((element) => element.textContent === "sha256:test"))

  messageListener({
    data: { id: 9, jsonrpc: "2.0", method: "ping", params: {} },
    source: parent,
  })
  messageListener({
    data: {
      id: 10,
      jsonrpc: "2.0",
      method: "ui/resource-teardown",
      params: { reason: "test complete" },
    },
    source: parent,
  })
  assert.deepEqual(plainJson(posted.slice(-2)), [
    { id: 9, jsonrpc: "2.0", result: {} },
    { id: 10, jsonrpc: "2.0", result: {} },
  ])

  assert.equal(messageListener, undefined)
})

test("legacy MCP catalogs expose exact plan-review app capability, resource, and linkage", async () => {
  await withCatalogClient(async (client) => {
    const [tools, resources, appResource] = await Promise.all([
      client.listTools(),
      client.listResources(),
      client.readResource({ uri: MCP_PLAN_REVIEW_APP_URI }),
    ])
    assert.deepEqual(
      client.getServerCapabilities()?.extensions?.[MCP_APP_EXTENSION_ID],
      { mimeTypes: [MCP_PLAN_REVIEW_APP_MIME_TYPE] },
    )
    const planTools = tools.tools.filter((tool) => tool.name.startsWith("plan_"))
    assert.deepEqual(planTools.map((tool) => tool.name).sort(), MCP_PLAN_REVIEW_TOOL_NAMES)
    for (const tool of planTools) assert.deepEqual(tool._meta, MCP_PLAN_REVIEW_TOOL_META)
    for (const tool of tools.tools.filter((entry) => !entry.name.startsWith("plan_"))) {
      assert.equal(tool._meta?.ui, undefined, tool.name)
    }
    assert.deepEqual(
      resources.resources.find((resource) => resource.uri === MCP_PLAN_REVIEW_APP_URI),
      {
        _meta: MCP_PLAN_REVIEW_APP_RESOURCE_META,
        description: "Display-only interactive review of exact Discord change plans without approval or execution authority.",
        mimeType: MCP_PLAN_REVIEW_APP_MIME_TYPE,
        name: "plan_review_app",
        title: "Discord plan review",
        uri: MCP_PLAN_REVIEW_APP_URI,
      },
    )
    assert.deepEqual(appResource.contents, [{
      _meta: MCP_PLAN_REVIEW_APP_RESOURCE_META,
      mimeType: MCP_PLAN_REVIEW_APP_MIME_TYPE,
      text: MCP_PLAN_REVIEW_APP_HTML,
      uri: MCP_PLAN_REVIEW_APP_URI,
    }])
  })
})
