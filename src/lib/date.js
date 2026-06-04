const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
})

function toValidDate(value) {
  if (!value) return null

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === 'string') {
    const match = value.match(DATE_ONLY_RE)
    if (match) {
      const year = Number(match[1])
      const month = Number(match[2]) - 1
      const day = Number(match[3])
      const parsed = new Date(year, month, day)
      return Number.isNaN(parsed.getTime()) ? null : parsed
    }
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatDateDDMMYY(value, fallback = 'N/A') {
  const date = toValidDate(value)
  if (!date) return fallback
  return DATE_FORMATTER.format(date)
}

const TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

// Like formatDateDDMMYY but also shows the time (e.g. "04/06/26 10:30 AM").
// Pure date-only strings (no time component) fall back to date-only output.
export function formatDateTimeDDMMYY(value, fallback = 'N/A') {
  const date = toValidDate(value)
  if (!date) return fallback
  if (typeof value === 'string' && DATE_ONLY_RE.test(value)) {
    return DATE_FORMATTER.format(date)
  }
  return `${DATE_FORMATTER.format(date)} ${TIME_FORMATTER.format(date)}`
}
