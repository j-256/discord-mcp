import { redactText } from "./errors.js"

export function redactMcpValue<T>(
  value: T,
  secrets: readonly (string | undefined)[],
): T {
  if (typeof value === "string") return redactText(value, secrets) as T
  if (Array.isArray(value)) {
    return value.map((entry) => redactMcpValue(entry, secrets)) as T
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactMcpValue(entry, secrets),
      ]),
    ) as T
  }
  return value
}

export function redactedJson(
  value: unknown,
  secrets: readonly (string | undefined)[],
): string {
  return JSON.stringify(redactMcpValue(value, secrets), null, 2)
}
