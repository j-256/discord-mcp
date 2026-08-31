import assert from "node:assert/strict"
import test from "node:test"

import {
  HOST_DETECTION_FORMAT,
  createHostDetectionMarkers,
  detectHosts,
  type HostDetectionMarkerKind,
  type HostDetectionPathMetadata,
} from "../src/host-detection.js"

function metadata(kind: HostDetectionMarkerKind): HostDetectionPathMetadata {
  return {
    isDirectory() {
      return kind === "directory"
    },
    isFile() {
      return kind === "file"
    },
  }
}

function pathError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

test("host detection defines platform-specific documented markers without a generic guess", () => {
  const darwin = createHostDetectionMarkers({
    cwd: "/workspace/project",
    environment: {},
    homeDirectory: "/Users/operator",
    platform: "darwin",
  })
  assert.equal(darwin.some(({ path }) => (
    path === "/Users/operator/Library/Application Support/Claude"
  )), true)
  assert.equal(darwin.some(({ path }) => (
    path === "/Users/operator/Library/Application Support/Code/User"
  )), true)
  assert.equal(darwin.some(({ path }) => (
    path === "/workspace/project/.vscode/mcp.json"
  )), true)

  const linux = createHostDetectionMarkers({
    cwd: "/work/project",
    environment: { XDG_CONFIG_HOME: "/private/config" },
    homeDirectory: "/home/operator",
    platform: "linux",
  })
  assert.equal(linux.some(({ hostId }) => hostId === "claude-desktop"), false)
  assert.equal(linux.some(({ path }) => path === "/private/config/Code/User"), true)

  const windows = createHostDetectionMarkers({
    cwd: "C:\\work\\project",
    environment: { APPDATA: "C:\\Users\\operator\\AppData\\Roaming" },
    homeDirectory: "C:\\Users\\operator",
    platform: "win32",
  })
  assert.equal(windows.some(({ path }) => (
    path === "C:\\Users\\operator\\AppData\\Roaming\\Claude"
  )), true)
  assert.equal(windows.some(({ path }) => (
    path === "C:\\work\\project\\.cursor\\mcp.json"
  )), true)
  for (const markers of [darwin, linux, windows]) {
    assert.equal(markers.map(({ hostId }) => String(hostId)).includes("mcp-json"), false)
    assert.equal(markers.every(({ documentationUrl }) => documentationUrl.startsWith("https://")), true)
  }
})

test("host detection reports no candidate after metadata-only missing-path checks", async () => {
  const inspected: string[] = []
  let contentReads = 0
  const filesystem = {
    async readFile() {
      contentReads += 1
      throw new Error("Host detection must not read candidate content")
    },
    async stat(path: string): Promise<HostDetectionPathMetadata> {
      inspected.push(path)
      throw pathError("ENOENT")
    },
  }
  const report = await detectHosts({
    cwd: "/work/project",
    environment: {},
    homeDirectory: "/home/operator",
    platform: "linux",
    stat: filesystem.stat,
  })

  assert.equal(report.format, HOST_DETECTION_FORMAT)
  assert.equal(report.status, "none")
  assert.deepEqual(report.candidates, [])
  assert.deepEqual(report.selection, {
    automatic: false,
    hostId: null,
    reason: "no-candidate",
  })
  assert.equal(inspected.length, report.coverage.checkedMarkerCount)
  assert.equal(contentReads, 0)
  assert.deepEqual(report.coverage.unscannedHostIds, ["claude-desktop"])
  assert.deepEqual(report.privacy, {
    credentialValuesRead: false,
    filesystemInspection: "metadata-only",
    hostConfigurationChanged: false,
    hostConfigurationContentsRead: false,
    networkRequestsIssued: false,
  })
})

test("host detection automatically selects exactly one candidate with all matched markers", async () => {
  const present = new Map<string, HostDetectionMarkerKind>([
    ["/custom/codex", "directory"],
    ["/work/project/.codex/config.toml", "file"],
  ])
  const report = await detectHosts({
    cwd: "/work/project",
    environment: { CODEX_HOME: "/custom/codex" },
    homeDirectory: "/home/operator",
    platform: "linux",
    async stat(path) {
      const kind = present.get(path)
      if (!kind) throw pathError("ENOENT")
      return metadata(kind)
    },
  })

  assert.equal(report.status, "selected")
  assert.deepEqual(report.selection, {
    automatic: true,
    hostId: "codex",
    reason: "single-candidate",
  })
  assert.deepEqual(report.candidates.map(({ hostId }) => hostId), ["codex"])
  assert.deepEqual(
    report.candidates[0]?.markers.map(({ path }) => path),
    ["/custom/codex", "/work/project/.codex/config.toml"],
  )
  assert.equal(Object.isFrozen(report), true)
  assert.equal(Object.isFrozen(report.candidates[0]?.markers), true)
})

test("host detection requires a choice when multiple host markers exist", async () => {
  const present = new Set([
    "/home/operator/.codex",
    "/home/operator/.cursor",
  ])
  const report = await detectHosts({
    cwd: "/work/project",
    environment: {},
    homeDirectory: "/home/operator",
    platform: "linux",
    async stat(path) {
      if (!present.has(path)) throw pathError("ENOENT")
      return metadata("directory")
    },
  })

  assert.equal(report.status, "choice-required")
  assert.deepEqual(report.candidates.map(({ hostId }) => hostId), ["codex", "cursor"])
  assert.deepEqual(report.selection, {
    automatic: false,
    hostId: null,
    reason: "multiple-candidates",
  })
})

test("host detection isolates inaccessible and wrong-type markers without claiming a host", async () => {
  const report = await detectHosts({
    cwd: "/work/project",
    environment: {},
    homeDirectory: "/home/operator",
    platform: "linux",
    async stat(path) {
      if (path === "/home/operator/.claude") throw pathError("EACCES")
      if (path === "/home/operator/.codex") return metadata("file")
      throw pathError("ENOENT")
    },
  })

  assert.equal(report.status, "none")
  assert.deepEqual(report.unavailableMarkers.map(({ hostId, reason }) => ({
    hostId,
    reason,
  })), [
    { hostId: "claude-code", reason: "inaccessible" },
    { hostId: "codex", reason: "unexpected-type" },
  ])
})
