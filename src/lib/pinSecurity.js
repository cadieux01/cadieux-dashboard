// ============================================================================
// pinSecurity.js — ACCOUNT-LEVEL dashboard PIN gate (server-verified).
// ----------------------------------------------------------------------------
// The 6-digit PIN that admin/sales users must enter before sensitive actions
// is stored ONLY as a bcrypt hash in `logistics.admin_pins`, keyed by the
// account id. All set/change/remove/verify/is-set operations run inside the
// `verify-admin-pin` Edge Function with the service-role key. The plaintext PIN
// and the hash NEVER live in the browser or localStorage.
//
// Because the PIN is keyed by account, a single shared admin login = one PIN
// that applies on EVERY device. This replaces the old localStorage SHA-256
// scheme, which was device-local and defaulted to ALLOW when no local hash was
// present (a device that never set a PIN could approve with none).
//
// Lockout (3 wrong attempts → 5 minutes) is authoritative in the DB, so every
// device agrees. The Edge Function returns the lockout/attempt state on each
// failed verify; this module surfaces it on the thrown Error.
// ============================================================================

import { supabase } from './supabase'

export const PIN_LENGTH = 6
export const MAX_ATTEMPTS = 3
export const LOCKOUT_MS = 5 * 60 * 1000 // mirrors the server constant for UI copy

// Short-lived "already verified this session" cache. A successful verify is
// remembered for the duration of the admin session so the gate doesn't prompt
// on every single click. The PIN itself is never stored — only an expiry. The
// cache is per-tab (sessionStorage) and cleared on sign-out / new login.
const VERIFIED_KEY = 'admin_pin_verified_until'
const VERIFIED_TTL_MS = 30 * 60 * 1000 // aligned to the 30-min admin session

const VERIFY_ADMIN_PIN_URL =
  import.meta.env?.VITE_VERIFY_ADMIN_PIN_URL ||
  'https://uejagupcwevadfhfuadv.supabase.co/functions/v1/verify-admin-pin'

// POST to the Edge Function with the caller's session JWT. Returns the parsed
// body on 2xx; throws an Error (with .status / .lockedMs / .attemptsLeft /
// .noPin attached when present) otherwise.
async function callPinFn(payload) {
  const { data: sessionWrap } = await supabase.auth.getSession()
  const token = sessionWrap?.session?.access_token
  if (!token) throw new Error('Not authenticated')

  let res
  try {
    res = await fetch(VERIFY_ADMIN_PIN_URL, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (networkErr) {
    throw new Error(
      `Could not reach the PIN service (${networkErr?.message || 'fetch failed'}). ` +
        `Check your connection and try again.`,
    )
  }

  let body = null
  try {
    const text = await res.text()
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }

  if (!res.ok) {
    const err = new Error((body && body.error) || `PIN service error (HTTP ${res.status})`)
    err.status = res.status
    if (body) {
      if (typeof body.lockedMs === 'number') err.lockedMs = body.lockedMs
      if (typeof body.attemptsLeft === 'number') err.attemptsLeft = body.attemptsLeft
      if (body.noPin) err.noPin = true
      if (body.locked) err.locked = true
    }
    throw err
  }
  return body || {}
}

// True if a PIN is configured for THIS ACCOUNT (server-derived, so every
// device agrees). Async — callers must await. DEFAULT-DENY: on any error we
// treat the PIN as "set" so the gate keeps blocking rather than letting an
// action through (the caller surfaces the error).
export async function isPinSet() {
  const body = await callPinFn({ action: 'is-set' })
  return !!body.isSet
}

// Store a brand-new PIN (first-time set). Throws if one already exists.
export async function setPin(pin) {
  const clean = String(pin || '').trim()
  if (clean.length !== PIN_LENGTH || !/^\d+$/.test(clean)) {
    throw new Error(`PIN must be exactly ${PIN_LENGTH} digits.`)
  }
  await callPinFn({ action: 'set', pin: clean })
}

// Change an existing PIN. Requires the CURRENT PIN.
export async function changePin(currentPin, newPin) {
  const cur = String(currentPin || '').trim()
  const next = String(newPin || '').trim()
  if (next.length !== PIN_LENGTH || !/^\d+$/.test(next)) {
    throw new Error(`New PIN must be exactly ${PIN_LENGTH} digits.`)
  }
  await callPinFn({ action: 'change', current_pin: cur, new_pin: next })
  clearVerifiedCache()
}

// Remove the PIN entirely. Requires the CURRENT PIN.
export async function removePin(currentPin) {
  await callPinFn({ action: 'remove', current_pin: String(currentPin || '').trim() })
  clearVerifiedCache()
}

// Forgot-PIN recovery: set a brand-new PIN without the current one, gated by
// the security question ("Who is your best friend?"). The answer is checked
// server-side; a wrong answer throws. On success the gate cache is cleared so
// the next sensitive action re-verifies with the new PIN.
export async function resetPin(securityAnswer, newPin) {
  const next = String(newPin || '').trim()
  if (next.length !== PIN_LENGTH || !/^\d+$/.test(next)) {
    throw new Error(`New PIN must be exactly ${PIN_LENGTH} digits.`)
  }
  await callPinFn({ action: 'reset', security_answer: String(securityAnswer || ''), new_pin: next })
  clearVerifiedCache()
}

// Verify a PIN for a gated action. Returns true on success (and refreshes the
// session cache); throws an Error carrying lockout / attempt info on failure.
export async function verifyPin(pin) {
  await callPinFn({ action: 'verify', pin: String(pin || '').trim() })
  markVerified()
  return true
}

// ── Session cache helpers ──────────────────────────────────────────────────
export function markVerified() {
  try {
    sessionStorage.setItem(VERIFIED_KEY, String(Date.now() + VERIFIED_TTL_MS))
  } catch { /* sessionStorage unavailable — just skip the cache */ }
}

export function isRecentlyVerified() {
  try {
    const until = parseInt(sessionStorage.getItem(VERIFIED_KEY) || '0', 10)
    return until > Date.now()
  } catch {
    return false
  }
}

export function clearVerifiedCache() {
  try { sessionStorage.removeItem(VERIFIED_KEY) } catch { /* noop */ }
}

// Convenience predicate: PIN is required for admin and sales. Partners never
// see it.
export function pinRequiredFor(role) {
  return role === 'admin' || role === 'sales'
}
