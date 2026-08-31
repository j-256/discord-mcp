import { stat as statPath } from "node:fs/promises"
import { homedir } from "node:os"
import { posix, win32 } from "node:path"

import { ConfigurationError } from "./errors.js"
import {
  ONBOARD_DETECTABLE_HOST_IDS,
  onboardHostDescriptor,
  type DetectableOnboardHostId,
} from "./onboard.js"

export const HOST_DETECTION_FORMAT = "guildcontrol.host-detection.v1"
export const HOST_DETECTION_SCHEMA_VERSION = 1

export type HostDetectionMarkerKind = "directory" | "file"
export type HostDetectionMarkerScope = "user" | "workspace"

export interface HostDetectionMarker {
  readonly documentationUrl: string
  readonly hostId: DetectableOnboardHostId
  readonly id: string
  readonly kind: HostDetectionMarkerKind
  readonly path: string
  readonly scope: HostDetectionMarkerScope
}

export interface HostDetectionCandidate {
  readonly hostId: DetectableOnboardHostId
  readonly markers: readonly HostDetectionMarker[]
  readonly title: string
}

export interface HostDetectionUnavailableMarker extends HostDetectionMarker {
  readonly reason: "inaccessible" | "unexpected-type"
}

export interface HostDetectionReport {
  readonly candidates: readonly HostDetectionCandidate[]
  readonly coverage: {
    readonly checkedHostIds: readonly DetectableOnboardHostId[]
    readonly checkedMarkerCount: number
    readonly unscannedHostIds: readonly DetectableOnboardHostId[]
  }
  readonly format: typeof HOST_DETECTION_FORMAT
  readonly limitations: readonly string[]
  readonly platform: NodeJS.Platform
  readonly privacy: {
    readonly credentialValuesRead: false
    readonly filesystemInspection: "metadata-only"
    readonly hostConfigurationChanged: false
    readonly hostConfigurationContentsRead: false
    readonly networkRequestsIssued: false
  }
  readonly schemaVersion: typeof HOST_DETECTION_SCHEMA_VERSION
  readonly selection:
    | {
        readonly automatic: false
        readonly hostId: null
        readonly reason: "multiple-candidates" | "no-candidate"
      }
    | {
        readonly automatic: true
        readonly hostId: DetectableOnboardHostId
        readonly reason: "single-candidate"
      }
  readonly status: "choice-required" | "none" | "selected"
  readonly unavailableMarkers: readonly HostDetectionUnavailableMarker[]
}

export interface HostDetectionPathMetadata {
  isDirectory(): boolean
  isFile(): boolean
}

export interface HostDetectionOptions {
  readonly cwd?: string
  readonly environment?: NodeJS.ProcessEnv
  readonly homeDirectory?: string
  readonly platform?: NodeJS.Platform
  readonly stat?: (path: string) => Promise<HostDetectionPathMetadata>
}

const CLAUDE_DESKTOP_DOCUMENTATION =
  "https://modelcontextprotocol.io/docs/develop/connect-local-servers"
const HOST_PATH_DOCUMENTATION: Readonly<
  Record<Exclude<DetectableOnboardHostId, "claude-desktop">, string>
> = Object.freeze({
  "claude-code": "https://code.claude.com/docs/en/mcp",
  codex: "https://developers.openai.com/codex/config-reference/",
  cursor: "https://cursor.com/docs/mcp",
  "gemini-extension": "https://geminicli.com/docs/extensions/reference/",
  vscode: "https://code.visualstudio.com/docs/agent-customization/mcp-servers",
})
const HOST_DETECTION_LIMITATIONS = Object.freeze([
  "A marker makes a host plausible; it does not prove that the host is installed, supported, running, or selected by the operator",
  "A fresh installation can have no marker, and a workspace marker can remain after a host is removed",
  "Workspace marker conventions can overlap across compatible hosts and do not prove operator intent",
  "Existence does not prove credential availability, write approval, elicitation, startup, or Discord access",
  "The generic mcp-json adapter has no unique host-owned marker and is never auto-detected",
  "Returned marker paths can contain private local directory names; keep detection output private",
])

type PathApi = typeof posix | typeof win32

function deepFreeze<Value>(value: Value): Value {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === code
}

function requiredAbsolutePath(
  value: string,
  label: string,
  pathApi: PathApi,
): string {
  const normalized = value.trim()
  if (!normalized || normalized.includes("\0") || !pathApi.isAbsolute(normalized)) {
    throw new ConfigurationError(`${label} must be an absolute path`)
  }
  return pathApi.resolve(normalized)
}

function optionalAbsolutePath(
  value: string | undefined,
  pathApi: PathApi,
): string | undefined {
  const normalized = value?.trim()
  return normalized && !normalized.includes("\0") && pathApi.isAbsolute(normalized)
    ? pathApi.resolve(normalized)
    : undefined
}

function marker(options: {
  documentationUrl: string
  hostId: DetectableOnboardHostId
  id: string
  kind: HostDetectionMarkerKind
  path: string
  scope: HostDetectionMarkerScope
}): HostDetectionMarker {
  return Object.freeze({ ...options })
}

export function createHostDetectionMarkers(
  options: Omit<HostDetectionOptions, "stat"> = {},
): readonly HostDetectionMarker[] {
  const platform = options.platform || process.platform
  const pathApi = platform === "win32" ? win32 : posix
  const environment = options.environment || process.env
  const defaultHome = options.homeDirectory
    || (platform === process.platform ? homedir() : "")
  const homeDirectory = requiredAbsolutePath(
    defaultHome,
    "Host detection home directory",
    pathApi,
  )
  const defaultCwd = options.cwd
    || (platform === process.platform ? process.cwd() : homeDirectory)
  const cwd = requiredAbsolutePath(
    defaultCwd,
    "Host detection working directory",
    pathApi,
  )
  const userConfigRoot = platform === "win32"
    ? optionalAbsolutePath(environment.APPDATA, pathApi)
      || pathApi.join(homeDirectory, "AppData", "Roaming")
    : platform === "darwin"
      ? pathApi.join(homeDirectory, "Library", "Application Support")
      : optionalAbsolutePath(environment.XDG_CONFIG_HOME, pathApi)
        || pathApi.join(homeDirectory, ".config")
  const codexHome = optionalAbsolutePath(environment.CODEX_HOME, pathApi)
    || pathApi.join(homeDirectory, ".codex")
  const markers: HostDetectionMarker[] = []

  if (platform === "darwin" || platform === "win32") {
    markers.push(marker({
      documentationUrl: CLAUDE_DESKTOP_DOCUMENTATION,
      hostId: "claude-desktop",
      id: "claude-desktop:user-configuration-directory",
      kind: "directory",
      path: pathApi.join(userConfigRoot, "Claude"),
      scope: "user",
    }))
  }
  markers.push(
    marker({
      documentationUrl: HOST_PATH_DOCUMENTATION["claude-code"],
      hostId: "claude-code",
      id: "claude-code:user-configuration-directory",
      kind: "directory",
      path: pathApi.join(homeDirectory, ".claude"),
      scope: "user",
    }),
    marker({
      documentationUrl: HOST_PATH_DOCUMENTATION["claude-code"],
      hostId: "claude-code",
      id: "claude-code:user-configuration-file",
      kind: "file",
      path: pathApi.join(homeDirectory, ".claude.json"),
      scope: "user",
    }),
    marker({
      documentationUrl: HOST_PATH_DOCUMENTATION["claude-code"],
      hostId: "claude-code",
      id: "claude-code:workspace-mcp-file",
      kind: "file",
      path: pathApi.join(cwd, ".mcp.json"),
      scope: "workspace",
    }),
    marker({
      documentationUrl: HOST_PATH_DOCUMENTATION.codex,
      hostId: "codex",
      id: "codex:user-configuration-directory",
      kind: "directory",
      path: codexHome,
      scope: "user",
    }),
    marker({
      documentationUrl: HOST_PATH_DOCUMENTATION.codex,
      hostId: "codex",
      id: "codex:workspace-configuration-file",
      kind: "file",
      path: pathApi.join(cwd, ".codex", "config.toml"),
      scope: "workspace",
    }),
    marker({
      documentationUrl: HOST_PATH_DOCUMENTATION.cursor,
      hostId: "cursor",
      id: "cursor:user-configuration-directory",
      kind: "directory",
      path: pathApi.join(homeDirectory, ".cursor"),
      scope: "user",
    }),
    marker({
      documentationUrl: HOST_PATH_DOCUMENTATION.cursor,
      hostId: "cursor",
      id: "cursor:workspace-mcp-file",
      kind: "file",
      path: pathApi.join(cwd, ".cursor", "mcp.json"),
      scope: "workspace",
    }),
    marker({
      documentationUrl: HOST_PATH_DOCUMENTATION.vscode,
      hostId: "vscode",
      id: "vscode:user-profile-directory",
      kind: "directory",
      path: pathApi.join(userConfigRoot, "Code", "User"),
      scope: "user",
    }),
    marker({
      documentationUrl: HOST_PATH_DOCUMENTATION.vscode,
      hostId: "vscode",
      id: "vscode:workspace-mcp-file",
      kind: "file",
      path: pathApi.join(cwd, ".vscode", "mcp.json"),
      scope: "workspace",
    }),
    marker({
      documentationUrl: HOST_PATH_DOCUMENTATION["gemini-extension"],
      hostId: "gemini-extension",
      id: "gemini-extension:user-configuration-directory",
      kind: "directory",
      path: pathApi.join(homeDirectory, ".gemini"),
      scope: "user",
    }),
    marker({
      documentationUrl: HOST_PATH_DOCUMENTATION["gemini-extension"],
      hostId: "gemini-extension",
      id: "gemini-extension:workspace-settings-file",
      kind: "file",
      path: pathApi.join(cwd, ".gemini", "settings.json"),
      scope: "workspace",
    }),
  )
  return deepFreeze(markers)
}

export async function detectHosts(
  options: HostDetectionOptions = {},
): Promise<HostDetectionReport> {
  const platform = options.platform || process.platform
  const markers = createHostDetectionMarkers(options)
  const inspect = options.stat || statPath
  const matched = new Map<DetectableOnboardHostId, HostDetectionMarker[]>()
  const unavailableMarkers: HostDetectionUnavailableMarker[] = []
  for (const candidate of markers) {
    try {
      const metadata = await inspect(candidate.path)
      const expectedType = candidate.kind === "directory"
        ? metadata.isDirectory()
        : metadata.isFile()
      if (!expectedType) {
        unavailableMarkers.push({ ...candidate, reason: "unexpected-type" })
        continue
      }
      const hostMarkers = matched.get(candidate.hostId) || []
      hostMarkers.push(candidate)
      matched.set(candidate.hostId, hostMarkers)
    } catch (error) {
      if (isNodeError(error, "ENOENT") || isNodeError(error, "ENOTDIR")) continue
      unavailableMarkers.push({ ...candidate, reason: "inaccessible" })
    }
  }
  const candidates = ONBOARD_DETECTABLE_HOST_IDS.flatMap((hostId) => {
    const hostMarkers = matched.get(hostId)
    return hostMarkers
      ? [{
          hostId,
          markers: hostMarkers,
          title: onboardHostDescriptor(hostId).title,
        }]
      : []
  })
  const checkedHostIds = ONBOARD_DETECTABLE_HOST_IDS.filter((hostId) => (
    markers.some((entry) => entry.hostId === hostId)
  ))
  const unscannedHostIds = ONBOARD_DETECTABLE_HOST_IDS.filter((hostId) => (
    !checkedHostIds.includes(hostId)
  ))
  const onlyCandidate = candidates.length === 1 ? candidates[0] : undefined
  const selection: HostDetectionReport["selection"] = onlyCandidate
    ? {
        automatic: true,
        hostId: onlyCandidate.hostId,
        reason: "single-candidate",
      }
    : {
        automatic: false,
        hostId: null,
        reason: candidates.length === 0 ? "no-candidate" : "multiple-candidates",
      }
  return deepFreeze({
    candidates,
    coverage: {
      checkedHostIds,
      checkedMarkerCount: markers.length,
      unscannedHostIds,
    },
    format: HOST_DETECTION_FORMAT,
    limitations: HOST_DETECTION_LIMITATIONS,
    platform,
    privacy: {
      credentialValuesRead: false as const,
      filesystemInspection: "metadata-only" as const,
      hostConfigurationChanged: false as const,
      hostConfigurationContentsRead: false as const,
      networkRequestsIssued: false as const,
    },
    schemaVersion: HOST_DETECTION_SCHEMA_VERSION,
    selection,
    status: candidates.length === 0
      ? "none" as const
      : candidates.length === 1
        ? "selected" as const
        : "choice-required" as const,
    unavailableMarkers,
  })
}
