// adminReset.js — client bindings for the super-admin "Forgot password"
// SMS-OTP recovery flow. These endpoints are PUBLIC (pre-login) and are
// served by the cadieux.in website. The server enforces that only an
// active super-admin phone actually receives a code; the responses here
// are intentionally generic so the UI can't be used to probe numbers.

const WEBSITE_BASE =
  import.meta.env?.VITE_CADIEUX_WEBSITE_URL || 'https://www.cadieux.in'

async function postJson(path, body) {
  let res
  try {
    res = await fetch(`${WEBSITE_BASE}${path}`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new Error(`Could not reach the server (${e?.message || 'fetch failed'}).`)
  }

  let parsed = null
  try {
    const raw = await res.text()
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = null
  }

  if (!res.ok) {
    const msg =
      (parsed && (parsed.error || parsed.message)) ||
      `Request failed (HTTP ${res.status})`
    throw new Error(msg)
  }
  return parsed ?? {}
}

/** Step 1: request an OTP. Always resolves generically on success. */
export function startAdminReset(phone) {
  return postJson('/api/admin/reset/start', { phone })
}

/** Step 2: verify the OTP and set a new password. */
export function verifyAdminReset(phone, code, newPassword) {
  return postJson('/api/admin/reset/verify', { phone, code, newPassword })
}
