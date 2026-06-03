// Shelf life configuration for each bread variant.
// `days` = total shelf life from assignment date.
// `warnHours` = hours remaining at which status becomes 'expiring_soon'.
export const SHELF_LIFE = {
  multigrain: { days: 3, label: 'Multi-Grain', warnHours: 24 },
  plain:      { days: 6, label: 'Plain',        warnHours: 36 },
}

/**
 * Hours remaining until shelf life expires (negative = already expired).
 * @param {string} variant      'multigrain' | 'plain'
 * @param {string} assignedDate ISO date string 'YYYY-MM-DD'
 * @param {Date}   [now]        Reference "now" — defaults to new Date()
 */
export function timeRemaining(variant, assignedDate, now = new Date()) {
  const sl = SHELF_LIFE[variant]
  if (!sl) return 0
  const assigned = new Date(assignedDate + 'T00:00:00')
  const elapsedMs = now - assigned
  const totalMs = sl.days * 24 * 60 * 60 * 1000
  return (totalMs - elapsedMs) / (60 * 60 * 1000) // hours
}

/**
 * Status of an assignment variant.
 * @returns 'active' | 'expiring_soon' | 'expired'
 */
export function getAssignmentStatus(variant, assignedDate, now = new Date()) {
  const sl = SHELF_LIFE[variant]
  if (!sl) return 'active'
  const remaining = timeRemaining(variant, assignedDate, now)
  if (remaining <= 0) return 'expired'
  if (remaining <= sl.warnHours) return 'expiring_soon'
  return 'active'
}

/** Human-readable time left / past label. */
export function timeLabel(hoursRemaining) {
  const abs = Math.abs(hoursRemaining)
  if (abs < 1) return hoursRemaining >= 0 ? '<1h left' : 'Just expired'
  if (abs < 24) {
    const h = Math.round(abs)
    return hoursRemaining >= 0 ? `${h}h left` : `${h}h past`
  }
  const d = Math.round(abs / 24)
  return hoursRemaining >= 0 ? `${d}d left` : `${d}d past`
}
