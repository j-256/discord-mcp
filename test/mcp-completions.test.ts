import assert from "node:assert/strict"
import test from "node:test"

import {
  Client,
  type CompleteResult,
  InMemoryTransport,
} from "@modelcontextprotocol/client"
import { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"

import {
  MCP_COMPLETION_VALUE_LIMIT,
  MCP_POLICY_COMPLETION_BINDINGS,
  completePolicyIds,
  policyCompletablePromptSchema,
  resourceTemplateCompletionCallbacks,
} from "../src/mcp-completions.js"
import {
  MCP_PROMPT_NAMES,
  MCP_RESOURCE_TEMPLATE_URIS,
} from "../src/mcp-guidance-catalog.js"
import {
  ScopePolicy,
  type PolicyDescription,
} from "../src/policy.js"
import { loadFixtureConfig } from "./config-fixture.js"

const TOKEN = "completion-test-token"
const FIRST_GUILD_ID = "100000000000000001"
const SECOND_GUILD_ID = "100000000000000002"

function basePolicy(): PolicyDescription {
  return new ScopePolicy(loadFixtureConfig({ token: TOKEN })).describe()
}

function policyWithGuilds(guildIds: readonly string[]): PolicyDescription {
  return {
    ...basePolicy(),
    allowedGuildIds: [...guildIds],
  }
}

test("policy completion candidates are deterministic, prefix-only, and valid", () => {
  const generated = Array.from({ length: MCP_COMPLETION_VALUE_LIMIT + 25 }, (_value, index) => (
    String(100000000000000000n + BigInt(index))
  )).reverse()
  const policy: PolicyDescription = {
    ...basePolicy(),
    allowedGuildIds: [
      ...generated,
      generated[0]!,
      "0",
      "18446744073709551616",
      "not-a-snowflake",
    ],
  }

  const result = completePolicyIds(policy, ["allowedGuildIds"], "")
  assert.deepEqual(result, [...new Set(generated)].sort())
  assert.deepEqual(completePolicyIds(policy, ["allowedGuildIds"], "100000000000000124"), [
    "100000000000000124",
  ])
  assert.deepEqual(completePolicyIds(policy, ["allowedGuildIds"], "x"), [])
  assert.deepEqual(completePolicyIds(policy, ["allowedGuildIds"], "1".repeat(21)), [])
  assert.deepEqual(completePolicyIds(undefined, ["allowedGuildIds"], ""), [])
})

test("completion bindings are immutable, unique, domain-specific, and exact", () => {
  const resourceTemplates = new Set<string>(Object.values(MCP_RESOURCE_TEMPLATE_URIS))
  const promptNames = new Set<string>(Object.values(MCP_PROMPT_NAMES))
  const keys = new Set<string>()
  const boundResourceTemplates = new Set<string>()
  const excludedPolicyFields = new Set([
    "memberRoleCount",
    "mentionUserCount",
    "protectedUserCount",
  ])
  const policy = basePolicy() as unknown as Record<string, unknown>

  assert.ok(Object.isFrozen(MCP_POLICY_COMPLETION_BINDINGS))
  for (const candidate of MCP_POLICY_COMPLETION_BINDINGS) {
    assert.ok(Object.isFrozen(candidate))
    assert.ok(Object.isFrozen(candidate.policyFields))
    const key = `${candidate.kind}:${candidate.reference}:${candidate.argument}`
    assert.equal(keys.has(key), false, key)
    keys.add(key)
    if (candidate.kind === "resource-template") {
      assert.equal(resourceTemplates.has(candidate.reference), true, candidate.reference)
      assert.match(candidate.reference, new RegExp(`\\{${candidate.argument}\\}`))
      boundResourceTemplates.add(candidate.reference)
    } else {
      assert.equal(promptNames.has(candidate.reference), true, candidate.reference)
    }
    for (const field of candidate.policyFields) {
      assert.equal(Array.isArray(policy[field]), true, field)
      assert.equal(excludedPolicyFields.has(field), false, field)
      assert.doesNotMatch(field, /protected|mention/i)
    }
  }
  assert.deepEqual(boundResourceTemplates, resourceTemplates)
})

test("resource callbacks combine only their declared public policy arrays", async () => {
  const policy: PolicyDescription = {
    ...basePolicy(),
    allowedChannelIds: ["200000000000000001"],
    channelMetadataIds: ["200000000000000002"],
    protectedUserCount: 9,
  }
  const operational = resourceTemplateCompletionCallbacks(
    MCP_RESOURCE_TEMPLATE_URIS.channelMetadata,
    policy,
  )
  const catalog = resourceTemplateCompletionCallbacks(
    MCP_RESOURCE_TEMPLATE_URIS.channelMetadata,
    undefined,
  )

  assert.deepEqual(await operational.complete?.channelId?.("200"), [
    "200000000000000001",
    "200000000000000002",
  ])
  assert.deepEqual(await catalog.complete?.channelId?.(""), [])
  assert.equal(operational.complete?.guildId, undefined)
})

async function promptCompletion(
  schema: z.ZodObject<z.ZodRawShape>,
  prefix: string,
): Promise<CompleteResult["completion"]> {
  const server = new McpServer({ name: "completion-schema-test", version: "1.0.0" })
  server.registerPrompt(
    MCP_PROMPT_NAMES.searchGuildMessages,
    { argsSchema: schema },
    ({ guildId }) => ({
      messages: [{
        content: { text: String(guildId), type: "text" as const },
        role: "user" as const,
      }],
    }),
  )
  const client = new Client(
    { name: "completion-schema-client", version: "1.0.0" },
    { capabilities: {} },
  )
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const result = await client.complete({
      argument: { name: "guildId", value: prefix },
      ref: { name: MCP_PROMPT_NAMES.searchGuildMessages, type: "ref/prompt" },
    })
    return result.completion
  } finally {
    await client.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }
}

test("MCP completion caps wire values while reporting every policy match", async () => {
  const guildIds = Array.from(
    { length: MCP_COMPLETION_VALUE_LIMIT + 25 },
    (_value, index) => String(100000000000000000n + BigInt(index)),
  )
  const schema = policyCompletablePromptSchema(
    MCP_PROMPT_NAMES.searchGuildMessages,
    z.strictObject({ guildId: z.string().regex(/^[0-9]{1,20}$/) }),
    policyWithGuilds(guildIds),
  )

  assert.deepEqual(await promptCompletion(schema, "100"), {
    hasMore: true,
    total: guildIds.length,
    values: guildIds.slice(0, MCP_COMPLETION_VALUE_LIMIT),
  })
})

test("prompt completion clones schemas and isolates server policies", async () => {
  const baseSchema = z.strictObject({
    guildId: z.string().regex(/^[0-9]{1,20}$/),
  })
  const firstSchema = policyCompletablePromptSchema(
    MCP_PROMPT_NAMES.searchGuildMessages,
    baseSchema,
    policyWithGuilds([FIRST_GUILD_ID]),
  )
  const secondSchema = policyCompletablePromptSchema(
    MCP_PROMPT_NAMES.searchGuildMessages,
    baseSchema,
    policyWithGuilds([SECOND_GUILD_ID]),
  )

  assert.notEqual(firstSchema, baseSchema)
  assert.notEqual(secondSchema, baseSchema)
  assert.notEqual(firstSchema, secondSchema)
  assert.deepEqual((await promptCompletion(firstSchema, "100")).values, [FIRST_GUILD_ID])
  assert.deepEqual((await promptCompletion(secondSchema, "100")).values, [SECOND_GUILD_ID])
})
