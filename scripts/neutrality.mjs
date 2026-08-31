// Keep blocked names out of the repository bytes that this gate scans
const SPECIFIC_REFERENCE_CODES = Object.freeze([
  [99, 111, 100, 101, 120],
  [111, 112, 101, 110, 97, 105],
  [99, 104, 97, 116, 103, 112, 116],
  [99, 108, 97, 117, 100, 101],
  [97, 110, 116, 104, 114, 111, 112, 105, 99],
  [99, 111, 112, 105, 108, 111, 116],
])
const SPECIFIC_REFERENCES = SPECIFIC_REFERENCE_CODES.map((codes) => String.fromCharCode(...codes))
const CLIENT_COMPATIBILITY_REFERENCES = Object.freeze([
  SPECIFIC_REFERENCES[0],
  SPECIFIC_REFERENCES[1],
  SPECIFIC_REFERENCES[3],
  String.fromCharCode(103, 101, 109, 105, 110, 105),
])
const ALL_REFERENCES = new Set([
  ...SPECIFIC_REFERENCES,
  ...CLIENT_COMPATIBILITY_REFERENCES,
])
const VERSIONED_MODEL_PREFIX = String.fromCharCode(103, 112, 116)
const VERSIONED_MODEL_PATTERN = new RegExp(`${VERSIONED_MODEL_PREFIX}[-_ ]?[0-9]`, "u")

export function containsSpecificReference(
  value,
  options = {},
) {
  const normalized = value.toLowerCase()
  return [...ALL_REFERENCES].some((reference) => (
    normalized.includes(reference)
    && (
      options.allowClientCompatibility !== true
      || !CLIENT_COMPATIBILITY_REFERENCES.includes(reference)
    )
  ))
    || VERSIONED_MODEL_PATTERN.test(normalized)
}
