export const COMPONENT_LINK_LIMITS = Object.freeze({
  buttonsPerRow: 5,
  labelCharacters: 80,
  origins: 100,
  urlCharacters: 512,
})

const URL_CONTROL_PATTERN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u

function unicodeLength(value: string): number {
  return [...value].length
}

function parsedHttpsUrl(value: unknown, path: string): URL {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    throw new RangeError(`${path} must be non-empty text without surrounding whitespace`)
  }
  if (URL_CONTROL_PATTERN.test(value)) {
    throw new RangeError(`${path} contains unsupported control characters`)
  }
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError(`${path} contains invalid Unicode`, { cause: error })
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch (error) {
    throw new RangeError(`${path} must be an absolute HTTPS URL`, { cause: error })
  }
  if (parsed.protocol !== "https:") {
    throw new RangeError(`${path} must use HTTPS`)
  }
  if (parsed.username || parsed.password) {
    throw new RangeError(`${path} must not contain credentials`)
  }
  return parsed
}

export function normalizeComponentLinkUrl(
  value: unknown,
  path = "Component link URL",
): string {
  const normalized = parsedHttpsUrl(value, path).toString()
  if (unicodeLength(normalized) > COMPONENT_LINK_LIMITS.urlCharacters) {
    throw new RangeError(
      `${path} must not exceed ${COMPONENT_LINK_LIMITS.urlCharacters} characters after normalization`,
    )
  }
  return normalized
}

export function componentLinkOrigin(url: string): string {
  return new URL(normalizeComponentLinkUrl(url)).origin
}

export function canonicalComponentLinkOrigin(
  value: unknown,
  path = "Component link origin",
): string {
  const parsed = parsedHttpsUrl(value, path)
  if (
    parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
    || value !== parsed.origin
  ) {
    throw new RangeError(
      `${path} must be an exact canonical HTTPS origin without a path, query, fragment, or trailing slash`,
    )
  }
  if (unicodeLength(parsed.origin) > COMPONENT_LINK_LIMITS.urlCharacters) {
    throw new RangeError(
      `${path} must not exceed ${COMPONENT_LINK_LIMITS.urlCharacters} characters`,
    )
  }
  return parsed.origin
}

export function canonicalComponentLinkOrigins(
  value: unknown,
  path = "Component link origins",
): string[] {
  if (!Array.isArray(value) || value.length > COMPONENT_LINK_LIMITS.origins) {
    throw new RangeError(
      `${path} must contain at most ${COMPONENT_LINK_LIMITS.origins} origins`,
    )
  }
  const origins = value.map((entry, index) => (
    canonicalComponentLinkOrigin(entry, `${path}[${index}]`)
  ))
  const canonical = [...new Set(origins)].sort()
  if (
    canonical.length !== origins.length
    || canonical.some((entry, index) => entry !== origins[index])
  ) {
    throw new RangeError(`${path} must be unique and sorted in canonical order`)
  }
  return origins
}
