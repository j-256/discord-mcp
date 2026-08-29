import type {
  output as ZodOutput,
  RefinementCtx as ZodRefinementCtx,
  ZodString as EagerZodString,
  ZodType,
} from "zod"
import { z as eagerZ } from "zod"

const LAZY_SCHEMA_FACTORIES = new Set([
  "array",
  "boolean",
  "discriminatedUnion",
  "enum",
  "literal",
  "looseObject",
  "null",
  "number",
  "object",
  "strictObject",
  "string",
  "union",
])

const MATERIALIZING_SCHEMA_PROPERTIES = new Set([
  "_def",
  "_zod",
  "description",
  "element",
  "encode",
  "encodeAsync",
  "isNullable",
  "isOptional",
  "keySchema",
  "meta",
  "options",
  "parse",
  "parseAsync",
  "safeParse",
  "safeParseAsync",
  "shape",
  "spa",
  "toJSONSchema",
  "type",
  "valueSchema",
  "~standard",
])

type Materialize = () => unknown

const materializers = new WeakMap<object, Materialize>()
const materializationStates = new WeakMap<object, { materialized: boolean }>()
let createdSchemaCount = 0
let materializedSchemaCount = 0

function materializeValue(value: unknown): unknown {
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    const materialize = materializers.get(value as object)
    if (materialize) return materialize()
  }
  if (Array.isArray(value)) {
    let changed = false
    const entries = value.map((entry) => {
      const materialized = materializeValue(entry)
      changed ||= materialized !== entry
      return materialized
    })
    return changed ? entries : value
  }
  if (
    typeof value === "object"
    && value !== null
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null)
  ) {
    let changed = false
    const entries = Object.entries(value).map(([key, entry]) => {
      const materialized = materializeValue(entry)
      changed ||= materialized !== entry
      return [key, materialized]
    })
    return changed ? Object.fromEntries(entries) : value
  }
  return value
}

function lazySchema<T>(create: () => T): T {
  createdSchemaCount += 1
  let concrete: T | undefined
  const state = { materialized: false }
  const materialize = (): T => {
    if (!state.materialized) {
      concrete = create()
      state.materialized = true
      materializedSchemaCount += 1
    }
    return concrete as T
  }
  const proxy = new Proxy({}, {
    get(_target, property) {
      if (property === "then") return undefined
      if (
        typeof property !== "string"
        || MATERIALIZING_SCHEMA_PROPERTIES.has(property)
      ) {
        const schema = materialize() as object
        const member = Reflect.get(schema, property, schema)
        return typeof member === "function" ? member.bind(schema) : member
      }
      return (...args: unknown[]) => lazySchema(() => {
        const schema = materialize() as object
        const member = Reflect.get(schema, property, schema)
        if (typeof member !== "function") {
          throw new TypeError(`Zod schema property ${property} is not callable`)
        }
        return member.apply(schema, materializeValue(args) as unknown[])
      })
    },
    has(_target, property) {
      if (property === "~standard" || property === "_zod") return true
      return Reflect.has(materialize() as object, property)
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(materialize() as object)
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(
        materialize() as object,
        property,
      )
      return descriptor ? { ...descriptor, configurable: true } : undefined
    },
    ownKeys() {
      return Reflect.ownKeys(materialize() as object)
    },
  })
  materializers.set(proxy, materialize)
  materializationStates.set(proxy, state)
  return proxy as T
}

function lazyNamespace<T extends object>(namespace: T): T {
  return new Proxy(namespace, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver)
      if (typeof member !== "function") return member
      return (...args: unknown[]) => lazySchema(() => (
        member.apply(target, materializeValue(args) as unknown[])
      ))
    },
  })
}

const iso = lazyNamespace(eagerZ.iso)

export const z: typeof eagerZ = new Proxy(eagerZ, {
  get(target, property, receiver) {
    if (property === "iso") return iso
    const member = Reflect.get(target, property, receiver)
    if (
      typeof property !== "string"
      || !LAZY_SCHEMA_FACTORIES.has(property)
      || typeof member !== "function"
    ) {
      return member
    }
    return (...args: unknown[]) => lazySchema(() => (
      member.apply(target, materializeValue(args) as unknown[])
    ))
  },
})

export function lazyZodSchemaState(
  value: unknown,
): "lazy" | "materialized" | undefined {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return undefined
  }
  const state = materializationStates.get(value as object)
  if (!state) return undefined
  return state.materialized ? "materialized" : "lazy"
}

export function lazyZodSchemaStatistics(): {
  created: number
  materialized: number
  pending: number
} {
  return {
    created: createdSchemaCount,
    materialized: materializedSchemaCount,
    pending: createdSchemaCount - materializedSchemaCount,
  }
}

export namespace z {
  export type infer<T extends ZodType> = ZodOutput<T>
  export type RefinementCtx = ZodRefinementCtx
  export type ZodString = EagerZodString
}
