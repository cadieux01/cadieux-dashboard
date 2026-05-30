// Phone-based login helpers.
//
// Sales execs and partners log in with a 10-digit Indian mobile number.
// To keep Supabase's standard email/password flow, that phone is mapped to a
// synthetic auth email of the form `<phone>@cadieux.<role>`
// (role ∈ {sales, partner}). These helpers build and decode those emails so
// the UI can show the real phone number instead of the synthetic email.
//
// Real-email accounts (e.g. sunny@gmail.com) are left untouched.

export const PHONE_LOGIN_ROLES = ['sales', 'partner']

// Indian mobile: exactly 10 digits, first digit 6-9.
const PHONE_RE = /^[6-9]\d{9}$/
const PHONE_EMAIL_RE = /^([6-9]\d{9})@cadieux\.(sales|partner)$/

/** Normalise loose input (+91, leading 0, spaces) to a bare 10-digit number. */
export function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  return digits
}

/** True when the value is (or normalises to) a valid 10-digit mobile. */
export function isValidPhone(value) {
  return PHONE_RE.test(normalizePhone(value))
}

/** Build the synthetic login email for a phone + role. */
export function buildLoginEmail(phone, role) {
  return `${normalizePhone(phone)}@cadieux.${role}`
}

/**
 * Strip the @cadieux.sales / @cadieux.partner suffix and return the phone.
 * Returns null when the email is not a synthetic phone-login email.
 */
export function extractPhone(email) {
  if (typeof email !== 'string') return null
  const match = email.match(PHONE_EMAIL_RE)
  return match ? match[1] : null
}

/**
 * Human-friendly login identifier: the phone number for synthetic emails,
 * otherwise the email as-is (real admin/email accounts).
 */
export function displayLogin(email) {
  return extractPhone(email) || email || null
}
