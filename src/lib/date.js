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
