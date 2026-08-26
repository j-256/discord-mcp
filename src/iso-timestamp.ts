const EXPLICIT_OFFSET_ISO_8601_PATTERN = /^(?<year>[0-9]{4})-(?<month>[0-9]{2})-(?<day>[0-9]{2})T(?<hour>[0-9]{2}):(?<minute>[0-9]{2}):(?<second>[0-9]{2})(?:\.[0-9]+)?(?<offset>Z|[+-](?<offsetHour>[0-9]{2}):(?<offsetMinute>[0-9]{2}))$/u

export function isExplicitOffsetIso8601Timestamp(
  value: unknown,
): value is string {
  if (typeof value !== "string") return false
  const parts = EXPLICIT_OFFSET_ISO_8601_PATTERN.exec(value)?.groups
  if (!parts) return false
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  const hour = Number(parts.hour)
  const minute = Number(parts.minute)
  const second = Number(parts.second)
  const offsetHour = parts.offset === "Z" ? 0 : Number(parts.offsetHour)
  const offsetMinute = parts.offset === "Z" ? 0 : Number(parts.offsetMinute)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1] ?? 0
  return year >= 1
    && month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 23
    && offsetMinute <= 59
    && !Number.isNaN(Date.parse(value))
}

export function canonicalExplicitOffsetIso8601Timestamp(
  value: unknown,
  description: string,
): string {
  if (!isExplicitOffsetIso8601Timestamp(value)) {
    throw new RangeError(`${description} must be an ISO 8601 timestamp with an explicit offset`)
  }
  return new Date(value).toISOString()
}
