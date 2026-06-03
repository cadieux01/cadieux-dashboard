// ============================================================================
// pinSecurity.js — client-side dashboard PIN gate.
// ----------------------------------------------------------------------------
// A 6-digit PIN that admin/sales users must enter before any write action.
// The PIN is set once by an admin (Profile page) and persisted as a SHA-256
// hash in localStorage. All other browsers learn the PIN out-of-band (admin
// shares it verbally or via ShareCredentials).
//
// Storage keys (localStorage):
//   dashboard_pin_hash         hex SHA-256 of the canonical PIN string
//   dashboard_pin_attempts     number of failed attempts in the current window
//   dashboard_pin_lock_until   ms timestamp; if > Date.now() the PIN gate is
//                              locked even with the correct PIN
//
// Behaviour:
//   - 3 wrong attempts in a row → 5-minute lockout
//   - Successful verify resets the attempt counter
//   - PIN is required ONLY for role === 'admin' or 'sales'
// ============================================================================

const PIN_HASH_KEY      = 'dashboard_pin_hash'
const PIN_ATTEMPTS_KEY  = 'dashboard_pin_attempts'
const PIN_LOCK_KEY      = 'dashboard_pin_lock_until'

export const PIN_LENGTH = 6
export const MAX_ATTEMPTS = 3
export const LOCKOUT_MS = 5 * 60 * 1000 // 5 minutes

// SHA-256 → lowercase hex. Uses Web Crypto so the plaintext never touches
// JS-land beyond this function.
async function sha256Hex(input) {
  const enc = new TextEncoder().encode(String(input))
  const buf = await crypto.subtle.digest('SHA-256', enc)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// True if a PIN has been configured on this browser.
export function isPinSet() {
  if (typeof window === 'undefined') return false
  return !!localStorage.getItem(PIN_HASH_KEY)
}

// Stores the new PIN (replacing any existing one). Returns nothing.
export async function setPin(pin) {
  const clean = String(pin || '').trim()
  if (clean.length !== PIN_LENGTH || !/^\d+$/.test(clean)) {
    throw new Error(`PIN must be exactly ${PIN_LENGTH} digits.`)
  }
  const hash = await sha256Hex(clean)
  localStorage.setItem(PIN_HASH_KEY, hash)
  localStorage.removeItem(PIN_ATTEMPTS_KEY)
  localStorage.removeItem(PIN_LOCK_KEY)
}

// Removes the PIN entirely (admin-only operation; gate the UI).
export function clearPin() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(PIN_HASH_KEY)
  localStorage.removeItem(PIN_ATTEMPTS_KEY)
  localStorage.removeItem(PIN_LOCK_KEY)
}

// Returns ms remaining in the current lockout, or 0 if not locked.
export function getLockoutRemainingMs() {
  if (typeof window === 'undefined') return 0
  const until = parseInt(localStorage.getItem(PIN_LOCK_KEY) || '0', 10)
  if (!until) return 0
  const remaining = until - Date.now()
  if (remaining <= 0) {
    localStorage.removeItem(PIN_LOCK_KEY)
    localStorage.removeItem(PIN_ATTEMPTS_KEY)
    return 0
  }
  return remaining
}

// Current consecutive failed-attempt count (0..MAX_ATTEMPTS).
export function getAttempts() {
  if (typeof window === 'undefined') return 0
  return parseInt(localStorage.getItem(PIN_ATTEMPTS_KEY) || '0', 10)
}

// Compares `pin` to the stored hash. On success returns true and resets the
// attempt counter. On failure increments attempts and triggers lockout when
// MAX_ATTEMPTS is reached. Throws if locked out.
export async function verifyPin(pin) {
  const remaining = getLockoutRemainingMs()
  if (remaining > 0) {
    const min = Math.ceil(remaining / 60000)
    throw new Error(`Locked out. Try again in ${min} minute${min === 1 ? '' : 's'}.`)
  }

  const stored = localStorage.getItem(PIN_HASH_KEY)
  if (!stored) throw new Error('No PIN set yet. Ask an admin to set one.')

  const hash = await sha256Hex(String(pin || '').trim())
  if (hash === stored) {
    localStorage.removeItem(PIN_ATTEMPTS_KEY)
    return true
  }

  const next = getAttempts() + 1
  if (next >= MAX_ATTEMPTS) {
    localStorage.setItem(PIN_LOCK_KEY, String(Date.now() + LOCKOUT_MS))
    localStorage.removeItem(PIN_ATTEMPTS_KEY)
    throw new Error(`Too many wrong attempts. Locked for 5 minutes.`)
  }
  localStorage.setItem(PIN_ATTEMPTS_KEY, String(next))
  throw new Error(`Wrong PIN. ${MAX_ATTEMPTS - next} attempt${MAX_ATTEMPTS - next === 1 ? '' : 's'} left.`)
}

// Convenience predicate used by callers to decide whether to render PinModal.
// PIN is required for admin and sales roles. Partners never see it.
export function pinRequiredFor(role) {
  return role === 'admin' || role === 'sales'
}
