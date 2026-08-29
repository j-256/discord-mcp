import assert from "node:assert/strict"
import test from "node:test"

import { z as eagerZ } from "zod"

import { lazyZodSchemaState, z } from "../src/lazy-z.js"

test("lazy Zod schemas materialize once at a concrete observation boundary", () => {
  const value = z.string().min(2).describe("bounded value")
  assert.equal(lazyZodSchemaState(value), "lazy")
  assert.equal("~standard" in value, true)
  assert.equal(lazyZodSchemaState(value), "lazy")
  const standard = value["~standard"]
  assert.equal(standard.vendor, "zod")
  assert.equal(lazyZodSchemaState(value), "materialized")
  assert.equal(value["~standard"], standard)
})

test("lazy Zod schemas preserve strict composition and JSON Schema", async () => {
  const lazy = z.strictObject({
    action: z.discriminatedUnion("type", [
      z.strictObject({ type: z.literal("enable"), value: z.boolean() }),
      z.strictObject({ type: z.literal("rename"), value: z.string().min(1) }),
    ]),
    count: z.number().int().min(1).default(2),
    timestamp: z.iso.datetime({ offset: true }),
  }).superRefine((value, context) => {
    if (value.action.type === "rename" && value.action.value === "blocked") {
      context.addIssue({ code: "custom", message: "reserved value" })
    }
  })
  const eager = eagerZ.strictObject({
    action: eagerZ.discriminatedUnion("type", [
      eagerZ.strictObject({ type: eagerZ.literal("enable"), value: eagerZ.boolean() }),
      eagerZ.strictObject({ type: eagerZ.literal("rename"), value: eagerZ.string().min(1) }),
    ]),
    count: eagerZ.number().int().min(1).default(2),
    timestamp: eagerZ.iso.datetime({ offset: true }),
  }).superRefine((value, context) => {
    if (value.action.type === "rename" && value.action.value === "blocked") {
      context.addIssue({ code: "custom", message: "reserved value" })
    }
  })
  assert.deepEqual(
    eagerZ.toJSONSchema(lazy, { io: "input", target: "draft-2020-12" }),
    eagerZ.toJSONSchema(eager, { io: "input", target: "draft-2020-12" }),
  )
  const input = {
    action: { type: "enable", value: true },
    timestamp: "2026-08-29T00:00:00Z",
  }
  assert.deepEqual(await lazy.parseAsync(input), await eager.parseAsync(input))
  assert.equal(lazy.safeParse({ ...input, extra: true }).success, false)
  assert.equal(lazy.safeParse({
    ...input,
    action: { type: "rename", value: "blocked" },
  }).success, false)
})

test("lazy Zod schemas preserve fluent composition and introspection", () => {
  const base = z.strictObject({ id: z.string() })
  const extended = base.extend({ enabled: z.boolean().default(false) })
  assert.equal(lazyZodSchemaState(base), "lazy")
  assert.equal(lazyZodSchemaState(extended), "lazy")
  assert.deepEqual(extended.parse({ id: "1" }), { enabled: false, id: "1" })
  assert.equal(extended instanceof eagerZ.ZodType, true)

  const optional = z.string().optional()
  const unwrapped = optional.unwrap()
  assert.equal(lazyZodSchemaState(unwrapped), "lazy")
  assert.equal(unwrapped.parse("value"), "value")

  const union = z.union([z.literal("one"), z.literal("two")])
  assert.equal(lazyZodSchemaState(union), "lazy")
  assert.equal(union.options.length, 2)
  assert.equal(lazyZodSchemaState(union), "materialized")
})

test("ordinary eager Zod values are not reported as lazy", () => {
  assert.equal(lazyZodSchemaState(eagerZ.string()), undefined)
  assert.equal(lazyZodSchemaState(null), undefined)
})
