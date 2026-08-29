import { SCHEMA_VERSION } from "./constants.js"
import type {
  GuildBlueprintFrontier,
  GuildBlueprintPhase,
  GuildBlueprintPhaseState,
  GuildBlueprintPlanStep,
  NormalizedGuildBlueprintRequest,
} from "./guild-blueprint-service.js"

export type GuildBlueprintPreviewReferenceResource =
  | "auto-moderation-rule"
  | "channel"
  | "message"
  | "onboarding-option"
  | "onboarding-prompt"
  | "role"
  | "user"

export type GuildBlueprintPreviewReference =
  | {
      id: string
      kind: "exact"
      path: string
      relationship: "uses"
      resource: GuildBlueprintPreviewReferenceResource
    }
  | {
      key: string
      kind: "scaffold"
      path: string
      relationship: "declares" | "uses"
      resource: "channel" | "role"
    }

export interface GuildBlueprintManifestPreviewEntry {
  dependsOn: string[]
  id: string
  key?: string
  kind: GuildBlueprintPhase
  manifestIndex?: number
  manifestPath: string
  potentialWriteStages: string[]
  references: GuildBlueprintPreviewReference[]
  sequenceIndex: number
}

export interface GuildBlueprintManifestPreview {
  authority: {
    discordContacted: false
    executablePlanCreated: false
    liveStateAssessed: false
    requestDigestAuthority: "comparison-only-not-an-approval"
    writeAuthorityGranted: false
  }
  normalizedManifest: Omit<NormalizedGuildBlueprintRequest, "operationKey">
  operationKeyHash: string
  privacy: {
    manifestPersistence: "none"
    rawOperationKeyReturned: false
    responseContent: "transient-untrusted-caller-input"
  }
  requestDigest: string
  schemaVersion: number
  sequence: GuildBlueprintManifestPreviewEntry[]
  status: "previewed"
  summary: {
    entries: number
    exactReferences: number
    potentialWriteStages: number
    scaffoldDeclarations: number
    scaffoldReferences: number
  }
  warnings: string[]
}

export interface GuildBlueprintManifestPlanAssessment {
  deferred: boolean
  executable: boolean
  freshlyAssessed: boolean
  nestedPlanDigest: string | null
  state: GuildBlueprintPhaseState
  writeRequired: boolean
}

export interface GuildBlueprintPlanManifestPreview {
  coverage: "complete-intent-sequence-current-frontier-only"
  entries: Array<GuildBlueprintManifestPreviewEntry & {
    assessment: GuildBlueprintManifestPlanAssessment
  }>
  executableEntryId: string | null
  frontierEntryId: string | null
  livePrerequisites: Array<{
    assessment: GuildBlueprintManifestPlanAssessment
    id: string
    kind: GuildBlueprintPhase
  }>
  summary: {
    assessed: number
    blocked: number
    deferred: number
    executable: number
    ready: number
    satisfied: number
    prerequisites: number
    total: number
  }
  warnings: string[]
}

interface EntrySource {
  key?: string
  kind: GuildBlueprintPhase
  manifestIndex?: number
  manifestPath: string
  references?: GuildBlueprintPreviewReference[]
  value: unknown
}

const ROLE_REFERENCE_FIELDS: ReadonlySet<string> = new Set([
  "anchor",
  "exemptRoles",
  "role",
  "roleOrder",
  "roles",
])

function referenceResource(field: string): GuildBlueprintPreviewReferenceResource | null {
  if (field === "ruleId") return "auto-moderation-rule"
  if (field === "messageId") return "message"
  if (field === "promptId") return "onboarding-prompt"
  if (field === "optionId") return "onboarding-option"
  if (field === "roleId" || field === "roleIds") return "role"
  if (field === "channelId" || field === "channelIds") return "channel"
  if (field === "userId" || field === "userIds" || field === "notifyUserIds") {
    return "user"
  }
  return null
}

function pushReference(
  references: GuildBlueprintPreviewReference[],
  reference: GuildBlueprintPreviewReference,
): void {
  const identity = reference.kind === "exact" ? reference.id : reference.key
  if (references.some((candidate) => (
    candidate.kind === reference.kind
    && candidate.path === reference.path
    && candidate.resource === reference.resource
    && (candidate.kind === "exact" ? candidate.id : candidate.key) === identity
  ))) return
  references.push(reference)
}

function collectReferences(
  value: unknown,
  path: string,
  references: GuildBlueprintPreviewReference[],
  field = "",
): void {
  if (typeof value === "string") {
    const resource = referenceResource(field)
    if (resource !== null) {
      pushReference(references, {
        id: value,
        kind: "exact",
        path,
        relationship: "uses",
        resource,
      })
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectReferences(item, `${path}[${index}]`, references, field)
    })
    return
  }
  if (value === null || typeof value !== "object") return
  const record = value as Record<string, unknown>
  if (record.kind === "scaffold" && typeof record.key === "string") {
    const resource = ROLE_REFERENCE_FIELDS.has(field)
      ? "role"
      : "channel"
    pushReference(references, {
      key: record.key,
      kind: "scaffold",
      path: `${path}.key`,
      relationship: "uses",
      resource,
    })
    return
  }
  if (record.kind === "exact") {
    if (typeof record.channelId === "string") {
      pushReference(references, {
        id: record.channelId,
        kind: "exact",
        path: `${path}.channelId`,
        relationship: "uses",
        resource: "channel",
      })
    }
    if (typeof record.roleId === "string") {
      pushReference(references, {
        id: record.roleId,
        kind: "exact",
        path: `${path}.roleId`,
        relationship: "uses",
        resource: "role",
      })
    }
    return
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "parentKey" && typeof child === "string") {
      pushReference(references, {
        key: child,
        kind: "scaffold",
        path: `${path}.${key}`,
        relationship: "uses",
        resource: "channel",
      })
      continue
    }
    collectReferences(child, `${path}.${key}`, references, key)
  }
}

function structureReferences(
  request: NormalizedGuildBlueprintRequest,
): GuildBlueprintPreviewReference[] {
  const references: GuildBlueprintPreviewReference[] = []
  request.scaffold.roles.forEach((role, index) => {
    pushReference(references, {
      key: role.key,
      kind: "scaffold",
      path: `$.scaffold.roles[${index}].key`,
      relationship: "declares",
      resource: "role",
    })
  })
  request.scaffold.channels.forEach((channel, index) => {
    pushReference(references, {
      key: channel.key,
      kind: "scaffold",
      path: `$.scaffold.channels[${index}].key`,
      relationship: "declares",
      resource: "channel",
    })
    if (channel.parentKey !== undefined) {
      pushReference(references, {
        key: channel.parentKey,
        kind: "scaffold",
        path: `$.scaffold.channels[${index}].parentKey`,
        relationship: "uses",
        resource: "channel",
      })
    }
  })
  return references
}

function entrySources(request: NormalizedGuildBlueprintRequest): EntrySource[] {
  const sources: EntrySource[] = [{
    kind: "structure",
    manifestPath: "$.scaffold",
    value: request.scaffold,
  }]
  request.roleConfigurations?.forEach((value, manifestIndex) => {
    sources.push({
      kind: "role-configuration",
      manifestIndex,
      manifestPath: `$.roleConfigurations[${manifestIndex}]`,
      value,
    })
  })
  if (request.roleOrder !== undefined) {
    for (let manifestIndex = request.roleOrder.length - 2;
      manifestIndex >= 0;
      manifestIndex -= 1) {
      const references: GuildBlueprintPreviewReference[] = []
      collectReferences(
        request.roleOrder[manifestIndex],
        `$.roleOrder[${manifestIndex}]`,
        references,
        "roleOrder",
      )
      collectReferences(
        request.roleOrder[manifestIndex + 1],
        `$.roleOrder[${manifestIndex + 1}]`,
        references,
        "roleOrder",
      )
      sources.push({
        kind: "role-ordering",
        manifestIndex,
        manifestPath: `$.roleOrder[${manifestIndex}:${manifestIndex + 2}]`,
        references,
        value: {
          anchor: request.roleOrder[manifestIndex + 1],
          role: request.roleOrder[manifestIndex],
        },
      })
    }
  }
  request.channelMetadata?.forEach((value, manifestIndex) => {
    sources.push({
      kind: "channel-metadata",
      manifestIndex,
      manifestPath: `$.channelMetadata[${manifestIndex}]`,
      value,
    })
  })
  let channelOrderIndex = 0
  request.channelOrders?.forEach((chain, chainIndex) => {
    for (let channelIndex = chain.channels.length - 2;
      channelIndex >= 0;
      channelIndex -= 1) {
      const channel = chain.channels[channelIndex]
      const anchor = chain.channels[channelIndex + 1]
      if (channel === undefined || anchor === undefined) {
        throw new RangeError(
          "Discord guild blueprint preview channel-order adjacency is missing",
        )
      }
      const references: GuildBlueprintPreviewReference[] = []
      collectReferences(
        channel,
        `$.channelOrders[${chainIndex}].channels[${channelIndex}]`,
        references,
        "channels",
      )
      collectReferences(
        anchor,
        `$.channelOrders[${chainIndex}].channels[${channelIndex + 1}]`,
        references,
        "channels",
      )
      sources.push({
        kind: "channel-ordering",
        manifestIndex: channelOrderIndex,
        manifestPath:
          `$.channelOrders[${chainIndex}].channels[${channelIndex}:${channelIndex + 2}]`,
        references,
        value: {
          acknowledgeReparenting: chain.acknowledgeReparenting,
          anchor,
          channel,
        },
      })
      channelOrderIndex += 1
    }
  })
  request.channelPermissionOverwrites?.forEach((value, manifestIndex) => {
    sources.push({
      kind: "channel-permission-overwrite",
      manifestIndex,
      manifestPath: `$.channelPermissionOverwrites[${manifestIndex}]`,
      value,
    })
  })
  const singletonSources: Array<{
    kind: Exclude<GuildBlueprintPhase,
      | "auto-moderation"
      | "channel-metadata"
      | "channel-ordering"
      | "channel-permission-overwrite"
      | "publication"
      | "role-configuration"
      | "role-ordering"
      | "structure">
    value: unknown
  }> = [
    { kind: "profile", value: request.profile },
    { kind: "settings", value: request.settings },
    { kind: "community", value: request.community },
    { kind: "welcome-screen", value: request.welcomeScreen },
    { kind: "onboarding", value: request.onboarding },
  ]
  for (const source of singletonSources) {
    if (source.value === undefined) continue
    const property = source.kind === "welcome-screen" ? "welcomeScreen" : source.kind
    sources.push({
      kind: source.kind,
      manifestPath: `$.${property}`,
      value: source.value,
    })
  }
  request.autoModerationRules?.forEach((value, manifestIndex) => {
    sources.push({
      key: value.key,
      kind: "auto-moderation",
      manifestIndex,
      manifestPath: `$.autoModerationRules[${manifestIndex}]`,
      value,
    })
  })
  request.publications?.forEach((value, manifestIndex) => {
    sources.push({
      key: value.key,
      kind: "publication",
      manifestIndex,
      manifestPath: `$.publications[${manifestIndex}]`,
      value,
    })
  })
  return sources
}

function entryId(source: EntrySource): string {
  return source.manifestIndex === undefined
    ? source.kind
    : `${source.kind}:${source.manifestIndex}`
}

function potentialWriteStages(source: EntrySource): string[] {
  if (source.kind === "structure") return ["create-additive-resource"]
  if (source.kind === "role-configuration") return ["configure-exact-role"]
  if (source.kind === "role-ordering") return ["order-resolved-role-adjacency"]
  if (source.kind === "channel-metadata") return ["configure-exact-channel"]
  if (source.kind === "channel-ordering") {
    const acknowledgeReparenting = (
      source.value as { acknowledgeReparenting?: true }
    ).acknowledgeReparenting === true
    return acknowledgeReparenting
      ? [
          "order-resolved-channel-adjacency",
          "reparent-resolved-channel-without-permission-sync",
        ]
      : ["order-resolved-channel-adjacency"]
  }
  if (source.kind === "channel-permission-overwrite") {
    return ["converge-exact-channel-target-overwrite"]
  }
  if (source.kind === "profile") return ["configure-guild-profile"]
  if (source.kind === "settings") return ["configure-guild-settings"]
  if (source.kind === "community") {
    return ["enable-community-if-required", "configure-community-routing"]
  }
  if (source.kind === "welcome-screen") return ["configure-welcome-screen"]
  if (source.kind === "onboarding") return ["configure-onboarding"]
  if (source.kind === "publication") {
    const action = (source.value as { action: "create" | "edit" }).action
    return [action === "create" ? "create-publication" : "edit-exact-publication"]
  }
  const enabled = (source.value as { enabled: boolean }).enabled
  return enabled
    ? ["disable-if-required", "configure", "enable"]
    : ["disable-if-required", "configure"]
}

function manifestSequence(
  request: NormalizedGuildBlueprintRequest,
): GuildBlueprintManifestPreviewEntry[] {
  const sources = entrySources(request)
  return sources.map((source, sequenceIndex) => {
    const references = source.references === undefined
      ? source.kind === "structure"
        ? structureReferences(request)
        : []
      : [...source.references]
    if (source.kind !== "structure" && source.references === undefined) {
      collectReferences(source.value, source.manifestPath, references)
    }
    return {
      dependsOn: sequenceIndex === 0 ? [] : [entryId(sources[sequenceIndex - 1] as EntrySource)],
      id: entryId(source),
      ...(source.key === undefined ? {} : { key: source.key }),
      kind: source.kind,
      ...(source.manifestIndex === undefined
        ? {}
        : { manifestIndex: source.manifestIndex }),
      manifestPath: source.manifestPath,
      potentialWriteStages: potentialWriteStages(source),
      references,
      sequenceIndex,
    }
  })
}

export function projectGuildBlueprintManifestPreview(
  request: NormalizedGuildBlueprintRequest,
  requestDigest: string,
): GuildBlueprintManifestPreview {
  const { operationKey: _operationKey, ...normalizedManifest } = request
  const sequence = manifestSequence(request)
  const references = sequence.flatMap((entry) => entry.references)
  return {
    authority: {
      discordContacted: false,
      executablePlanCreated: false,
      liveStateAssessed: false,
      requestDigestAuthority: "comparison-only-not-an-approval",
      writeAuthorityGranted: false,
    },
    normalizedManifest,
    operationKeyHash: request.operationKeyHash,
    privacy: {
      manifestPersistence: "none",
      rawOperationKeyReturned: false,
      responseContent: "transient-untrusted-caller-input",
    },
    requestDigest,
    schemaVersion: SCHEMA_VERSION,
    sequence,
    status: "previewed",
    summary: {
      entries: sequence.length,
      exactReferences: references.filter((reference) => reference.kind === "exact").length,
      potentialWriteStages: sequence.reduce(
        (total, entry) => total + entry.potentialWriteStages.length,
        0,
      ),
      scaffoldDeclarations: references.filter((reference) => (
        reference.kind === "scaffold" && reference.relationship === "declares"
      )).length,
      scaffoldReferences: references.filter((reference) => (
        reference.kind === "scaffold" && reference.relationship === "uses"
      )).length,
    },
    warnings: [
      "This local preview validates and normalizes caller input but does not contact Discord",
      "Potential write stages are an upper-bound vocabulary, not a claim that live state requires any write",
      "Future Discord IDs, permissions, capacity, hierarchy, receipts, and post-write state remain unknown until a fresh live plan reaches that entry",
      "The request digest is a comparison identifier only; it is not an executable plan digest, approval, confirmation, or write authority",
    ],
  }
}

function stepId(step: GuildBlueprintPlanStep): string {
  return step.kind === "auto-moderation"
    || step.kind === "channel-metadata"
    || step.kind === "channel-ordering"
    || step.kind === "channel-permission-overwrite"
    || step.kind === "publication"
    || step.kind === "role-configuration"
    || step.kind === "role-ordering"
    ? `${step.kind}:${step.index}`
    : step.kind
}

function frontierId(frontier: GuildBlueprintFrontier | null): string | null {
  if (frontier === null) return null
  return frontier.kind === "auto-moderation"
    || frontier.kind === "channel-metadata"
    || frontier.kind === "channel-ordering"
    || frontier.kind === "channel-permission-overwrite"
    || frontier.kind === "publication"
    || frontier.kind === "role-configuration"
    || frontier.kind === "role-ordering"
    ? `${frontier.kind}:${frontier.index}`
    : frontier.kind
}

export function projectGuildBlueprintPlanManifestPreview(
  preview: GuildBlueprintManifestPreview,
  steps: readonly GuildBlueprintPlanStep[],
  frontier: GuildBlueprintFrontier | null,
): GuildBlueprintPlanManifestPreview {
  const stepsById = new Map<string, GuildBlueprintPlanStep>()
  for (const step of steps) {
    const id = stepId(step)
    if (stepsById.has(id)) {
      throw new RangeError("Discord guild blueprint live plan contains a duplicate step")
    }
    stepsById.set(id, step)
  }
  const liveFrontierId = frontierId(frontier)
  const entries = preview.sequence.map((entry) => {
    const step = stepsById.get(entry.id)
    if (step === undefined) {
      throw new RangeError("Discord guild blueprint preview entry is missing from the live plan")
    }
    stepsById.delete(entry.id)
    const freshlyAssessed = step.state !== "waiting"
    const executable = liveFrontierId === entry.id
      && frontier?.writeRequired === true
      && step.state === "ready"
      && step.writeRequired
    return {
      ...entry,
      assessment: {
        deferred: !freshlyAssessed,
        executable,
        freshlyAssessed,
        nestedPlanDigest: step.nestedPlanDigest,
        state: step.state,
        writeRequired: step.writeRequired,
      },
    }
  })
  const executableEntries = entries.filter((entry) => entry.assessment.executable)
  if (
    liveFrontierId !== null
    && !entries.some((entry) => entry.id === liveFrontierId)
  ) {
    throw new RangeError("Discord guild blueprint preview frontier is missing")
  }
  const writeReadyEntries = entries.filter((entry) => (
    entry.assessment.state === "ready" && entry.assessment.writeRequired
  ))
  if (
    writeReadyEntries.length > 1
    || (writeReadyEntries.length === 1 && writeReadyEntries[0]?.id !== liveFrontierId)
    || (frontier?.writeRequired === true && executableEntries.length !== 1)
  ) {
    throw new RangeError("Discord guild blueprint preview frontier is inconsistent")
  }
  const livePrerequisites = [...stepsById.entries()].map(([id, step]) => {
    if (
      id !== "community"
      || step.kind !== "community"
      || step.nestedPlanDigest !== null
      || step.state !== "blocked"
      || step.writeRequired
    ) {
      throw new RangeError(
        "Discord guild blueprint preview contains an unsupported live prerequisite",
      )
    }
    return {
      assessment: {
        deferred: false,
        executable: false,
        freshlyAssessed: true,
        nestedPlanDigest: null,
        state: step.state,
        writeRequired: false,
      },
      id,
      kind: step.kind,
    }
  })
  return {
    coverage: "complete-intent-sequence-current-frontier-only",
    entries,
    executableEntryId: executableEntries[0]?.id ?? null,
    frontierEntryId: liveFrontierId,
    livePrerequisites,
    summary: {
      assessed: entries.filter((entry) => entry.assessment.freshlyAssessed).length,
      blocked: entries.filter((entry) => entry.assessment.state === "blocked").length,
      deferred: entries.filter((entry) => entry.assessment.deferred).length,
      executable: executableEntries.length,
      ready: entries.filter((entry) => entry.assessment.state === "ready").length,
      satisfied: entries.filter((entry) => entry.assessment.state === "satisfied").length,
      prerequisites: livePrerequisites.length,
      total: entries.length,
    },
    warnings: [
      "Every manifest entry is shown, but only non-deferred entries were assessed against the live state used by this plan",
      "Only executableEntryId, when present, corresponds to the single fresh reviewed frontier this plan may execute",
      "Deferred entries do not predict future Discord IDs, permissions, capacity, hierarchy, receipts, or post-write state",
      "Live prerequisites are planner-discovered safety dependencies outside the caller-authored manifest and never grant implicit write authority",
    ],
  }
}
