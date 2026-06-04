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

/** Total shelf life in days for a variant. */
export function shelfDays(variant) {
  return SHELF_LIFE[variant]?.days ?? 0
}

/**
 * Current day number of an assignment, 1-based and clamped to [1, days].
 * Day 1 = assignment day. Day N = N-1 full days later.
 */
export function shelfDay(variant, assignedDate, now = new Date()) {
  const sl = SHELF_LIFE[variant]
  if (!sl) return 1
  const assigned = new Date(assignedDate + 'T00:00:00')
  const elapsedDays = Math.floor((now - assigned) / (24 * 60 * 60 * 1000))
  return Math.min(Math.max(elapsedDays + 1, 1), sl.days)
}

/** Whole days of shelf life remaining (0 once expired). */
export function daysLeft(variant, assignedDate, now = new Date()) {
  const hrs = timeRemaining(variant, assignedDate, now)
  return Math.max(0, Math.ceil(hrs / 24))
}

/** Percentage of shelf life consumed, 0–100. */
export function shelfPercentUsed(variant, assignedDate, now = new Date()) {
  const sl = SHELF_LIFE[variant]
  if (!sl) return 0
  const assigned = new Date(assignedDate + 'T00:00:00')
  const elapsedMs = now - assigned
  const totalMs = sl.days * 24 * 60 * 60 * 1000
  return Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100))
}

/** True when the assignment is on its final shelf-life day (and not expired). */
export function isLastDay(variant, assignedDate, now = new Date()) {
  const sl = SHELF_LIFE[variant]
  if (!sl) return false
  if (timeRemaining(variant, assignedDate, now) <= 0) return false
  return shelfDay(variant, assignedDate, now) >= sl.days
}

/**
 * The day number a unit was sold on, relative to its assignment date.
 * sellDay = floor((saleDate - assignmentDate) / 24h) + 1  (1-based).
 */
export function sellDay(assignedDate, saleDate) {
  const assigned = new Date(assignedDate + 'T00:00:00')
  const sold = new Date(saleDate + 'T00:00:00')
  return Math.max(1, Math.floor((sold - assigned) / (24 * 60 * 60 * 1000)) + 1)
}
